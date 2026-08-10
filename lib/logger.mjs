import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const logsDir = join(__dirname, "..", "logs");
mkdirSync(logsDir, { recursive: true });

export function logOperation({ method, path, body, status, response, error }) {
  const day = new Date().toISOString().slice(0, 10);
  const file = join(logsDir, `operations_${day}.jsonl`);
  const entry = {
    timestamp: new Date().toISOString(),
    method,
    path,
    body: body ?? null,
    status: status ?? null,
    response: response ?? null,
    error: error ?? null,
  };
  appendFileSync(file, JSON.stringify(entry) + "\n");
}
