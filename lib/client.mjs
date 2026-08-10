import { loadEnv } from "./env.mjs";
import { logOperation } from "./logger.mjs";

const BASE_URL = "https://api.tiendanube.com/2025-03";
const USER_AGENT = "NGC Automation (ngc9136@gmail.com)";
const MIN_INTERVAL_MS = 500; // 2 req/s

let lastRequestAt = 0;
let detectedAuthHeaderName = null; // "Authorization" | "Authentication", set after first successful call

async function throttle() {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - elapsed);
  }
  lastRequestAt = Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaders(headerName, token, extra = {}) {
  const authValue =
    headerName === "Authorization" ? `Bearer ${token}` : `bearer ${token}`;
  return {
    [headerName]: authValue,
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function rawRequest({ storeId, token, method, path, headerName, query, body }) {
  await throttle();
  const url = new URL(`${BASE_URL}/${storeId}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    method,
    headers: buildHeaders(headerName, token),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res;
}

export function createClient() {
  const env = loadEnv();
  const storeId = env.STORE_ID;
  const token = env.ACCESS_TOKEN;

  async function detectAuthHeader() {
    if (detectedAuthHeaderName) return detectedAuthHeaderName;
    // Try the modern header first, fall back to the legacy one on 401.
    for (const candidate of ["Authorization", "Authentication"]) {
      const res = await rawRequest({
        storeId,
        token,
        method: "GET",
        path: "/store",
        headerName: candidate,
      });
      if (res.status !== 401) {
        detectedAuthHeaderName = candidate;
        return candidate;
      }
    }
    throw new Error(
      "Ningun header de autenticacion funciono (probados: Authorization Bearer, Authentication bearer). Revisa el ACCESS_TOKEN."
    );
  }

  async function request(method, path, { query, body, maxRetries = 5 } = {}) {
    const headerName = await detectAuthHeader();
    let attempt = 0;
    while (true) {
      const res = await rawRequest({
        storeId,
        token,
        method,
        path,
        headerName,
        query,
        body,
      });

      if (res.status === 429) {
        attempt += 1;
        if (attempt > maxRetries) {
          throw new Error(`429 persistente tras ${maxRetries} reintentos en ${method} ${path}`);
        }
        const resetMs = Number(res.headers.get("x-rate-limit-reset"));
        const waitMs = Number.isFinite(resetMs) && resetMs > 0 ? resetMs : 1000 * attempt;
        await sleep(waitMs);
        continue;
      }

      return res;
    }
  }

  async function getJson(path, opts) {
    const res = await request("GET", path, opts);
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error(`GET ${path} -> ${res.status}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return { data, headers: res.headers };
  }

  async function putJson(path, body) {
    const res = await request("PUT", path, { body });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    logOperation({ method: "PUT", path, body, status: res.status, response: data });
    if (!res.ok) {
      const err = new Error(`PUT ${path} -> ${res.status}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return { data, headers: res.headers };
  }

  async function postJson(path, body) {
    const res = await request("POST", path, { body });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    logOperation({ method: "POST", path, body, status: res.status, response: data });
    if (!res.ok) {
      const err = new Error(`POST ${path} -> ${res.status}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return { data, headers: res.headers };
  }

  async function getAllPages(path, baseQuery = {}) {
    const perPage = 200;
    let page = 1;
    let total = null;
    const results = [];
    while (true) {
      const { data, headers } = await getJson(path, {
        query: { ...baseQuery, per_page: perPage, page },
      });
      if (total === null) {
        const totalHeader = headers.get("x-total-count");
        total = totalHeader ? Number(totalHeader) : null;
      }
      if (!Array.isArray(data) || data.length === 0) break;
      results.push(...data);
      if (total !== null && results.length >= total) break;
      if (data.length < perPage) break;
      page += 1;
    }
    return results;
  }

  return {
    storeId,
    detectAuthHeader,
    getJson,
    putJson,
    postJson,
    getAllPages,
    get authHeaderUsed() {
      return detectedAuthHeaderName;
    },
  };
}
