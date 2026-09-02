// Front de mentira para probar verify-front.mjs.
// Modo sano por defecto; con ?roto=1 reproduce las 6 fallas que el verificador
// tiene que atrapar (bloque ausente, banners que no cargan, nombres cortados,
// line-clamp sobre el contenedor, boton sin contraste, ficha kilometrica).
import http from 'node:http';
import { png } from './png.mjs';

const NOMBRES = [
  'Parche bordado jerarquia Fuerza Aerea Argentina con abrojo talle grande',
  'Gorra tactica FAA bordada con visera curva y ajuste de abrojo',
  'Llavero metalico Hercules C-130 edicion aniversario',
  'Campera bomber MA-1 con parches de escuadron desmontables',
];

function home(roto) {
  const banners = [1, 2, 3, 4]
    .map((n) =>
      roto && n > 1
        // lazy que no dispara: la fuente queda en data-src y nunca pasa a src
        ? `<img class="js-slide" data-src="/banner-${n}.png" alt="banner ${n}">`
        : `<img class="js-slide" src="/banner-${n}.png" alt="banner ${n}">`
    )
    .join('\n');

  const tarjetas = NOMBRES.map(
    (n) => `<div class="item">
      <a class="item-link" href="/ficha">
        <img src="/thumb.png" alt="">
        <div class="js-item-name item-name">${n}</div>
        <div class="item-price">$ 24.900</div>
        <div class="item-installments">6 cuotas sin interes</div>
      </a>
    </div>`
  ).join('\n');

  const estiloRoto = `
    .item-link{display:block;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;display:-webkit-box}
    .js-item-name{height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .btn-primary{background:#3382fa;color:#2c3e50}`;
  const estiloSano = `
    .item-link{display:inline}
    .js-item-name{height:auto;overflow:visible;white-space:normal}
    .btn-primary{background:#1a56b0;color:#ffffff}`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NGC</title>
<style>
  body{margin:0;background:#2c3e50;color:#fff;font:14px system-ui}
  .js-home-slider{display:flex;gap:4px}
  .js-home-slider img{width:24%;height:120px;object-fit:cover}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;padding:12px}
  .item{background:#1d2b3a;padding:8px;border-radius:8px}
  .item img{width:100%;height:120px;object-fit:cover}
  .btn-primary{border:0;padding:10px 18px;border-radius:6px;font-weight:700}
  ${roto ? estiloRoto : estiloSano}
</style>
${roto ? '' : '<style id="ngc-fix">/* bloque real */</style>'}
</head><body>
<div class="js-home-slider">${banners}</div>
<div class="grid">${tarjetas}</div>
<button class="btn-primary">Comprar ahora</button>
${roto ? '' : '<script id="ngc-fix-js">/* bloque real */</script>'}
</body></html>`;
}

function ficha(roto) {
  const n = roto ? 60 : 12;
  const slides = Array.from({ length: n }, (_, i) =>
    `<div class="swiper-slide"><img data-src="/foto-${i}.png" src="/foto-${i}.png" alt="foto ${i}"></div>`
  ).join('\n');
  const estilo = roto
    // swiper que no se inicializa: las fotos se apilan en una columna
    ? '.product-detail-slider img{display:block;width:100%;height:600px;object-fit:contain}'
    : '.product-detail-slider{height:520px;overflow:hidden}.product-detail-slider img{width:100%;height:520px;object-fit:contain}';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:type" content="product"><title>Ficha</title>
<style>body{margin:0;background:#2c3e50}${estilo}</style>
${roto ? '' : '<style id="ngc-fix"></style>'}
</head><body>
<h1>Parche bordado</h1>
<div class="product-detail-slider">${slides}</div>
${roto ? '' : '<script id="ngc-fix-js"></script>'}
</body></html>`;
}

export function arrancar() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const roto = u.searchParams.get('roto') === '1';
    if (u.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(home(roto));
    }
    if (u.pathname === '/ficha') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(ficha(roto));
    }
    if (u.pathname.endsWith('.png')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(png(400, 200, [11, 19, 39]));
    }
    res.writeHead(404).end('404');
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }))
  );
}

if (process.argv[1] && process.argv[1].endsWith('front-falso.mjs')) {
  arrancar().then(({ base }) => console.log('front falso en', base, '\n  sano:', base + '/', '\n  roto:', base + '/?roto=1'));
}
