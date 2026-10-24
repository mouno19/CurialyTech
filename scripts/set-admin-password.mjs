#!/usr/bin/env node
// Sets ADMIN_PASSWORD_HASH (and SESSION_SECRET if missing) in /etc/curialyai.env.
// Usage: sudo node scripts/set-admin-password.mjs            (prompts, input hidden)
//        sudo CURIALY_ENV_FILE=/path node scripts/set-admin-password.mjs
import { randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import readline from "node:readline";

const envFile = process.env.CURIALY_ENV_FILE || "/etc/curialyai.env";

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = text => { if (text.includes(question)) process.stdout.write(text); };
    rl.question(question, answer => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

const password = process.env.CURIALY_NEW_PASSWORD || await ask("New admin password: ");
if (password.length < 12) {
  console.error("Use at least 12 characters.");
  process.exit(1);
}
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
const value = `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`;

let lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").split("\n").filter(Boolean) : [];
lines = lines.filter(line => !line.startsWith("ADMIN_PASSWORD_HASH="));
lines.push(`ADMIN_PASSWORD_HASH=${value}`);
if (!lines.some(line => line.startsWith("SESSION_SECRET="))) lines.push(`SESSION_SECRET=${randomBytes(48).toString("base64url")}`);
fs.writeFileSync(envFile, `${lines.join("\n")}\n`, { mode: 0o600 });
console.log(`Updated ${envFile}. Restart the service: sudo systemctl restart curialyai`);
