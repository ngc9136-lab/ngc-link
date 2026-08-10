import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "../lib/client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backupDir = join(__dirname, "..", "backup");
mkdirSync(backupDir, { recursive: true });

const today = new Date().toISOString().slice(0, 10);

const client = createClient();
await client.detectAuthHeader();

console.log("Bajando productos (per_page=200, paginado completo)...");
const products = await client.getAllPages("/products");
const productsPath = join(backupDir, `products_${today}.json`);
writeFileSync(productsPath, JSON.stringify(products, null, 2));
console.log(`Productos guardados: ${products.length} -> ${productsPath}`);

console.log("Bajando categorias (per_page=200, paginado completo)...");
const categories = await client.getAllPages("/categories");
const categoriesPath = join(backupDir, `categories_${today}.json`);
writeFileSync(categoriesPath, JSON.stringify(categories, null, 2));
console.log(`Categorias guardadas: ${categories.length} -> ${categoriesPath}`);
