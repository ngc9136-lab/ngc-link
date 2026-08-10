import { createClient } from "../lib/client.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const productId = args.product;
const variantId = args.variant;
const confirm = Boolean(args.confirm);

if (!productId || !variantId) {
  console.error("Uso: node scripts/04-fix-variant.mjs --product=ID --variant=ID [--confirm]");
  process.exit(1);
}

const client = createClient();
await client.detectAuthHeader();

const { data: product } = await client.getJson(`/products/${productId}`);
const attributesCount = Array.isArray(product.attributes) ? product.attributes.length : 0;

const variant = (product.variants ?? []).find((v) => String(v.id) === String(variantId));
if (!variant) {
  throw new Error(`No se encontro la variante ${variantId} dentro del producto ${productId} (GET en vivo).`);
}

console.log("Producto (en vivo):", productId, JSON.stringify(product.name));
console.log("Attributes (en vivo):", JSON.stringify(product.attributes, null, 2));
console.log("Values actuales de la variante (en vivo):", JSON.stringify(variant.values, null, 2));

if (!Array.isArray(variant.values) || variant.values.length !== attributesCount) {
  throw new Error(
    `Mismatch: la variante tiene ${variant.values?.length} elementos en 'values' pero el producto tiene ${attributesCount} 'attributes'. Abortando por seguridad.`
  );
}

let replaced = 0;
const newValues = variant.values.map((v) => {
  const text = typeof v === "object" ? Object.values(v).join(" ") : String(v);
  if (text.toUpperCase().includes("ALEFEREZ")) {
    replaced += 1;
    return { es: "ALFÉREZ" };
  }
  return v;
});

if (replaced !== 1) {
  throw new Error(
    `Se esperaba encontrar exactamente 1 elemento con "ALEFEREZ" en values, se encontraron ${replaced}. Abortando por seguridad.`
  );
}

const body = { values: newValues };

console.log("");
console.log(`PUT /products/${productId}/variants/${variantId}`);
console.log("Body:", JSON.stringify(body, null, 2));

if (!confirm) {
  console.log("");
  console.log("Dry-run (no se ejecuto nada). Volve a correr con --confirm para aplicar el cambio.");
  process.exit(0);
}

const { data: updated } = await client.putJson(`/products/${productId}/variants/${variantId}`, body);
console.log("");
console.log("PUT ejecutado. Respuesta:", JSON.stringify(updated, null, 2));

const { data: verify } = await client.getJson(`/products/${productId}/variants/${variantId}`);
console.log("");
console.log("GET de verificacion post-cambio:", JSON.stringify(verify, null, 2));
