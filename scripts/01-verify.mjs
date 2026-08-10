import { createClient } from "../lib/client.mjs";

const client = createClient();
const headerName = await client.detectAuthHeader();
const { data } = await client.getJson("/store");

const name = data?.name?.es ?? data?.name ?? JSON.stringify(data?.name);
console.log(`Header de autenticacion que funciono: "${headerName}"`);
console.log(`Nombre de la tienda: ${name}`);
