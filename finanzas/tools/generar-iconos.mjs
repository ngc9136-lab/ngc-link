// Generador de íconos PNG para la PWA, sin dependencias externas.
// Uso: node tools/generar-iconos.mjs   (desde la carpeta finanzas/)
// Dibuja un fondo oscuro redondeado, tres barras ascendentes y una moneda.
// Cada píxel se muestrea 4x4 veces para suavizar los bordes (antialiasing).
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(OUT, { recursive: true });

// ---------- Codificador PNG mínimo (RGBA 8 bits) ----------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(tipo, datos) {
  const len = Buffer.alloc(4); len.writeUInt32BE(datos.length);
  const td = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filtro "none"
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Escena en coordenadas normalizadas 0..1 ----------
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const FONDO = hex('#0b0f14'), FONDO2 = hex('#1c2430'), AZUL = hex('#3987e5'), VERDE = hex('#0ca30c'), ORO = hex('#fab219');

function dentroRectRedondeado(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
// Devuelve el color [r,g,b,a] del punto (x,y). "safe" reduce el dibujo para íconos "maskable".
function color(x, y, maskable) {
  const s = maskable ? 0.72 : 0.86, o = (1 - s) / 2; // zona segura
  const u = (x - o) / s, v = (y - o) / s;
  // Fondo: en maskable ocupa todo el cuadrado; en normal es un cuadrado redondeado.
  const enFondo = maskable || dentroRectRedondeado(x, y, 0.02, 0.02, 0.98, 0.98, 0.2);
  if (!enFondo) return [0, 0, 0, 0];
  // Degradé vertical sutil
  const t = y; const base = FONDO.map((c, i) => Math.round(c + (FONDO2[i] - c) * t));
  // Barras ascendentes
  const barras = [[0.14, 0.62], [0.36, 0.46], [0.58, 0.28]];
  for (const [bx, top] of barras) {
    if (dentroRectRedondeado(u, v, bx, top, bx + 0.16, 0.86, 0.04)) return [...(bx > 0.5 ? VERDE : AZUL), 255];
  }
  // Moneda (círculo dorado con anillo interior)
  const d = Math.hypot(u - 0.24, v - 0.24);
  if (d <= 0.15) return d > 0.105 || d < 0.07 ? [...ORO, 255] : [...base.map(c => Math.min(255, c + 40)), 255];
  return [...base, 255];
}
function render(tam, maskable) {
  const buf = Buffer.alloc(tam * tam * 4); const SS = 4;
  for (let py = 0; py < tam; py++) for (let px = 0; px < tam; px++) {
    let acc = [0, 0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const c = color((px + (sx + 0.5) / SS) / tam, (py + (sy + 0.5) / SS) / tam, maskable);
      acc = acc.map((a, i) => a + (i < 3 ? c[i] * c[3] : c[3]));
    }
    const a = acc[3] / (SS * SS); const i = (py * tam + px) * 4;
    buf[i] = a ? Math.round(acc[0] / acc[3]) : 0; buf[i + 1] = a ? Math.round(acc[1] / acc[3]) : 0;
    buf[i + 2] = a ? Math.round(acc[2] / acc[3]) : 0; buf[i + 3] = Math.round(a);
  }
  return png(tam, tam, buf);
}

const salidas = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]];
for (const [nombre, tam, mask] of salidas) {
  writeFileSync(join(OUT, nombre), render(tam, mask));
  console.log('Generado', nombre);
}
