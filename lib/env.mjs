import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");

export function loadEnv() {
  if (!existsSync(envPath)) {
    throw new Error(
      `No se encontro .env en ${envPath}. Crealo con STORE_ID y ACCESS_TOKEN (ver .env.example).`
    );
  }
  const raw = readFileSync(envPath, "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  if (!env.STORE_ID || !env.ACCESS_TOKEN) {
    throw new Error("El .env debe tener STORE_ID y ACCESS_TOKEN definidos.");
  }
  return env;
}
