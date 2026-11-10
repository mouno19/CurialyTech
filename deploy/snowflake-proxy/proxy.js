const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const POOL_FILE = path.join(__dirname, "pool.json");
const PORT = Number(process.env.PORT || 8082);

// Load or initialize pool
let pool = null;
function loadPool() {
  try {
    if (fs.existsSync(POOL_FILE)) {
      const data = JSON.parse(fs.readFileSync(POOL_FILE, "utf8"));
      if (Array.isArray(data.accounts) && data.accounts.length > 0) {
        pool = data;
        if (typeof pool.currentIndex !== "number" || pool.currentIndex >= pool.accounts.length) {
          pool.currentIndex = 0;
        }
        console.log(`[Pool] Loaded ${pool.accounts.length} accounts. Active index: ${pool.currentIndex} (ID: ${pool.accounts[pool.currentIndex].id})`);
        return;
      }
    }
  } catch (err) {
    console.error("[Pool] Failed to read pool.json:", err.message);
  }
  // Fallback to environment
  pool = {
    currentIndex: 0,
    accounts: [{
      id: 0,
      host: process.env.SNOWFLAKE_HOST || "og34722.ap-southeast-7.aws.snowflakecomputing.com",
      pat: process.env.SNOWFLAKE_PAT || ""
    }]
  };
}

loadPool();

function getActiveAccount() {
  return pool.accounts[pool.currentIndex];
}

function rotateToNextAccount() {
  const prevIndex = pool.currentIndex;
  const prevAcc = pool.accounts[prevIndex];
  pool.currentIndex = (pool.currentIndex + 1) % pool.accounts.length;
  const nextAcc = pool.accounts[pool.currentIndex];
  console.log(`[Pool] Rotating from Account #${prevAcc.id} (${prevAcc.account || prevAcc.host}) -> Account #${nextAcc.id} (${nextAcc.account || nextAcc.host})`);

  try {
    fs.writeFileSync(POOL_FILE, JSON.stringify(pool, null, 2), "utf8");
  } catch (err) {
    console.error("[Pool] Failed to persist pool.json:", err.message);
  }

  // Attempt to keep /etc/snowflake-proxy.env updated if writable
  try {
    const envContent = `SNOWFLAKE_HOST=${nextAcc.host}\nSNOWFLAKE_PAT=${nextAcc.pat}\n`;
    fs.writeFileSync("/etc/snowflake-proxy.env", envContent);
  } catch (_) {}

  return nextAcc;
}

// Native Cortex Claude models pass through unchanged; legacy aliases map to a current model.
const NATIVE_CLAUDE = [
  "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5",
  "claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-5-5",
];
const BUDGET_THINKING = new Set(["claude-opus-4-5", "claude-sonnet-4-5"]);
const CHAT_MODELS = new Set(["openai-gpt-5.5", "openai-gpt-5.4", "openai-gpt-5.2", "openai-gpt-5", "grok-4.7", "grok-4.6", "kimi-k3", "glm-5.3"]);

const MODEL_MAP = {
  ...Object.fromEntries(NATIVE_CLAUDE.map(id => [id, id])),
  "claude-opus-4.8": "claude-opus-4-8",
  "claude-3-opus": "claude-opus-5-5",
  "claude-3-opus-20240229": "claude-opus-5-5",
  "opus": "claude-opus-5-5",
  "claude-sonnet-4-5": "claude-sonnet-4-5",
  "claude-3-7-sonnet-20250219": "claude-sonnet-4-5",
  "claude-3-5-sonnet-20241022": "claude-sonnet-4-5",
  "claude-3-5-sonnet": "claude-sonnet-4-5",
  "sonnet": "claude-sonnet-4-5"
};

const ALLOWED_CORTEX_KEYS = new Set([
  "model",
  "messages",
  "max_tokens",
  "system",
  "temperature",
  "top_p",
  "top_k",
  "tools",
  "tool_choice",
  "stream",
  "thinking",
  "output_config",
  "stop_sequences"
]);

function forwardWithRetry(res, path, body, accept, retryCount = 0) {
  const currentAcc = getActiveAccount();
  const maxRetries = Math.min(pool.accounts.length, 10);

  const proxyReq = https.request({
    hostname: currentAcc.host,
    port: 443,
    path,
    method: "POST",
    headers: {
      "host": currentAcc.host,
      "authorization": "Bearer " + currentAcc.pat,
      "x-snowflake-authorization-token-type": "PROGRAMMATIC_ACCESS_TOKEN",
      "user-agent": "cortex-cli/1.0",
      "content-type": "application/json",
      "accept": accept,
      "content-length": Buffer.byteLength(body)
    }
  }, (proxyRes) => {
    // If upstream indicates exhausted credits (401 / 403 / unauthorized)
    if ((proxyRes.statusCode === 401 || proxyRes.statusCode === 403) && retryCount < maxRetries) {
      let errBody = "";
      proxyRes.on("data", chunk => errBody += chunk);
      proxyRes.on("end", () => {
        console.warn(`[Proxy Failover] Upstream returned HTTP ${proxyRes.statusCode} on account #${currentAcc.id}: ${errBody.slice(0, 150)}`);
        rotateToNextAccount();
        // Transparently retry the exact request with the new account
        forwardWithRetry(res, path, body, accept, retryCount + 1);
      });
      return;
    }

    // Normal response (200, or legitimate user error like 400 Bad Request)
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error("[Proxy Error]", err.message);
    if (retryCount < maxRetries) {
      rotateToNextAccount();
      return forwardWithRetry(res, path, body, accept, retryCount + 1);
    }
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  });

  proxyReq.write(body);
  proxyReq.end();
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*"
    });
    return res.end();
  }

  if (req.url === "/" || req.url === "/health") {
    const acc = getActiveAccount();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      status: "ok",
      provider: "Cortex Auto-Failover Bridge",
      poolSize: pool.accounts.length,
      currentAccountIndex: pool.currentIndex,
      currentAccountId: acc ? acc.id : null
    }));
  }

  if (req.url === "/v1/models" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      data: [...Object.keys(MODEL_MAP), ...CHAT_MODELS].map(id => ({ id, type: "model" }))
    }));
  }

  let chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", () => {
    let rawBody = Buffer.concat(chunks).toString("utf8");

    if (req.url.includes("count_tokens")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ input_tokens: Math.ceil(rawBody.length / 4) }));
    }

    if (req.url.startsWith("/cortex/inference")) {
      return forwardWithRetry(res, "/api/v2/cortex/inference:complete", rawBody, req.headers["accept"] || "text/event-stream");
    }

    if (req.url.startsWith("/v1/chat/completions")) {
      let chat;
      try { chat = JSON.parse(rawBody); } catch (e) { chat = null; }
      if (!chat || !CHAT_MODELS.has(chat.model)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "Unknown chat model" } }));
      }
      if (chat.max_tokens != null && chat.max_completion_tokens == null) chat.max_completion_tokens = chat.max_tokens;
      delete chat.max_tokens;
      return forwardWithRetry(res, "/api/v2/cortex/v1/chat/completions", JSON.stringify(chat), req.headers["accept"] || (chat.stream ? "text/event-stream" : "application/json"));
    }

    let bodyJson = {};
    try {
      bodyJson = JSON.parse(rawBody);
    } catch (e) {
      bodyJson = {};
    }

    const cleanBody = {};
    for (const key of Object.keys(bodyJson)) {
      if (ALLOWED_CORTEX_KEYS.has(key)) {
        cleanBody[key] = bodyJson[key];
      }
    }

    const requestedModel = cleanBody.model || "claude-opus-5-5";
    cleanBody.model = MODEL_MAP[requestedModel] || (requestedModel.includes("sonnet") ? "claude-sonnet-4-5" : "claude-opus-5-5");

    if (cleanBody.model === "claude-opus-5-5") {
      const display = cleanBody.thinking && cleanBody.thinking.display;
      cleanBody.thinking = display ? { type: "adaptive", display } : { type: "adaptive" };
      if (!cleanBody.output_config) {
        cleanBody.output_config = { effort: "medium" };
      }
    } else if (cleanBody.thinking && cleanBody.thinking.type === "enabled" && !BUDGET_THINKING.has(requestedModel)) {
      delete cleanBody.thinking;
    }

    const modifiedBody = JSON.stringify(cleanBody);
    const acceptHeader = req.headers["accept"] || (cleanBody.stream ? "text/event-stream" : "application/json");

    forwardWithRetry(res, "/api/v2/cortex/v1/messages", modifiedBody, acceptHeader);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Snowflake Cortex Bridge with Auto-Failover listening on 127.0.0.1:${PORT}`);
});
