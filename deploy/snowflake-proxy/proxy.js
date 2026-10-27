const http = require("http");
const https = require("https");

const SNOWFLAKE_HOST = process.env.SNOWFLAKE_HOST || "og34722.ap-southeast-7.aws.snowflakecomputing.com";
const SNOWFLAKE_PAT = process.env.SNOWFLAKE_PAT;
if (!SNOWFLAKE_PAT) {
  console.error("SNOWFLAKE_PAT is not set (expected via /etc/snowflake-proxy.env)");
  process.exit(1);
}
const PORT = Number(process.env.PORT || 8082);

// Native Cortex Claude models pass through unchanged; legacy aliases map to a current model.
const NATIVE_CLAUDE = [
  "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5",
  "claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-5-5",
];
// Models that accept {"thinking": {"type": "enabled", "budget_tokens": N}} (no adaptive thinking).
const BUDGET_THINKING = new Set(["claude-opus-4-5", "claude-sonnet-4-5"]);
// Served by Cortex's OpenAI-compatible chat/completions endpoint.
// (Gemini on Cortex and llama3.3-70b are SQL-only, served by the app through AI_COMPLETE.)
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

function forward(res, path, body, accept) {
  const proxyReq = https.request({
    hostname: SNOWFLAKE_HOST,
    port: 443,
    path,
    method: "POST",
    headers: {
      "host": SNOWFLAKE_HOST,
      "authorization": "Bearer " + SNOWFLAKE_PAT,
      "x-snowflake-authorization-token-type": "PROGRAMMATIC_ACCESS_TOKEN",
      "user-agent": "cortex-cli/1.0",
      "content-type": "application/json",
      "accept": accept,
      "content-length": Buffer.byteLength(body)
    }
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on("error", (err) => {
    console.error("Proxy error:", err);
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
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: "ok", provider: "Snowflake Cortex Proxy" }));
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

    // Open-weight models (Llama/Mistral) live on Cortex's inference:complete endpoint,
    // not the Anthropic-compatible messages endpoint, so forward them verbatim.
    if (req.url.startsWith("/cortex/inference")) {
      return forward(res, "/api/v2/cortex/inference:complete", rawBody, req.headers["accept"] || "text/event-stream");
    }

    // OpenAI-format models (GPT, Grok, Kimi, GLM): Cortex wants max_completion_tokens.
    if (req.url.startsWith("/v1/chat/completions")) {
      let chat;
      try { chat = JSON.parse(rawBody); } catch (e) { chat = null; }
      if (!chat || !CHAT_MODELS.has(chat.model)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "Unknown chat model" } }));
      }
      if (chat.max_tokens != null && chat.max_completion_tokens == null) chat.max_completion_tokens = chat.max_tokens;
      delete chat.max_tokens;
      return forward(res, "/api/v2/cortex/v1/chat/completions", JSON.stringify(chat), req.headers["accept"] || (chat.stream ? "text/event-stream" : "application/json"));
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
      // Keep the caller's display preference ("summarized" streams readable thinking).
      const display = cleanBody.thinking && cleanBody.thinking.display;
      cleanBody.thinking = display ? { type: "adaptive", display } : { type: "adaptive" };
      if (!cleanBody.output_config) {
        cleanBody.output_config = { effort: "medium" };
      }
    } else if (cleanBody.thinking && cleanBody.thinking.type === "enabled" && !BUDGET_THINKING.has(requestedModel)) {
      // Only the 4.5 generation takes budgeted thinking; newer models use adaptive.
      delete cleanBody.thinking;
    }

    const modifiedBody = JSON.stringify(cleanBody);

    const headers = {
      "host": SNOWFLAKE_HOST,
      "authorization": "Bearer " + SNOWFLAKE_PAT,
      "x-snowflake-authorization-token-type": "PROGRAMMATIC_ACCESS_TOKEN",
      "user-agent": "cortex-cli/1.0",
      "content-type": "application/json",
      "accept": req.headers["accept"] || (cleanBody.stream ? "text/event-stream" : "application/json"),
      "content-length": Buffer.byteLength(modifiedBody)
    };

    const proxyReq = https.request({
      hostname: SNOWFLAKE_HOST,
      port: 443,
      path: "/api/v2/cortex/v1/messages",
      method: "POST",
      headers: headers
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error("Proxy error:", err);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    });

    proxyReq.write(modifiedBody);
    proxyReq.end();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Snowflake Cortex Bridge for Claude Code listening on 127.0.0.1:${PORT}`);
});