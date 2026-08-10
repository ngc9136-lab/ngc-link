import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backupDir = join(__dirname, "..", "backup");

const productsFile = readdirSync(backupDir)
  .filter((f) => f.startsWith("products_") && f.endsWith(".json"))
  .sort()
  .pop();

if (!productsFile) {
  throw new Error("No hay backup de productos en ./backup. Corre 02-backup.mjs primero.");
}

const path = join(backupDir, productsFile);
console.log(`Usando backup: ${path}`);
const products = JSON.parse(readFileSync(path, "utf8"));

const matches = [];
for (const product of products) {
  for (const variant of product.variants ?? []) {
    for (const v of variant.values ?? []) {
      const text = typeof v === "object" ? Object.values(v).join(" ") : String(v);
      if (text.toUpperCase().includes("ALEFEREZ")) {
        matches.push({ product, variant });
      }
    }
  }
}

if (matches.length === 0) {
  console.log('No se encontro ninguna variante con "ALEFEREZ" en el backup.');
  process.exit(0);
}

for (const { product, variant } of matches) {
  const name = product.name?.es ?? product.name;
  console.log("=== PRODUCTO ===");
  console.log(`id: ${product.id}`);
  console.log(`name: ${JSON.stringify(product.name)}`);
  console.log(`attributes: ${JSON.stringify(product.attributes, null, 2)}`);
  console.log("=== VARIANTE ===");
  console.log(`id: ${variant.id}`);
  console.log(`values: ${JSON.stringify(variant.values, null, 2)}`);
  console.log("");
}
