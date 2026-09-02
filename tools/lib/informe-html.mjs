// Hoja de contacto: cada grupo de fotos repetidas con las miniaturas reales,
// la que se queda en verde y las sobrantes en rojo. Sin listas de posiciones
// para contar a mano.
import fs from 'node:fs';
import path from 'node:path';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const kb = (n) => (n == null ? '?' : n < 1024 ? n + ' B' : (n / 1024).toFixed(0) + ' KB');

export function escribirHojaDeContacto(destino, informe, cacheDir) {
  const dirInforme = path.dirname(destino);
  // Ruta relativa desde el HTML hasta el blob cacheado: la miniatura funciona
  // sin internet. Si el HTML se mueve de lugar, el onerror cae al CDN.
  const miniatura = (e) => {
    const local = e.rutaCache
      ? path.relative(dirInforme, path.join(cacheDir, e.rutaCache)).split(path.sep).join('/')
      : '';
    return `<img loading="lazy" src="${esc(local || e.url)}" data-cdn="${esc(e.url)}" onerror="if(this.src!==this.dataset.cdn)this.src=this.dataset.cdn">`;
  };

  const r = informe.resumen;
  const conDup = informe.productos.filter((p) => p.archivosDuplicados > 0);
  const sinDup = informe.productos.filter((p) => p.archivosDuplicados === 0);

  const bloqueGrupo = (g) => `
    <div class="grupo">
      <div class="grupo-cab">
        <span class="hash" title="SHA-256 del archivo">${esc(g.sha256.slice(0, 16))}…</span>
        <span class="cuenta">${g.repeticiones} copias identicas &middot; sobran ${g.sobrantes}</span>
      </div>
      <div class="tira">
        ${g.entradas
          .map(
            (e, i) => `
          <figure class="${i === 0 ? 'queda' : 'sobra'}">
            ${miniatura(e)}
            <figcaption>
              <b>${i === 0 ? 'SE QUEDA' : 'SOBRA'}</b>
              <span>pos. ${e.posicion}</span>
              <span>${e.ancho ?? '?'}&times;${e.alto ?? '?'}</span>
              <span>${kb(e.bytes)}</span>
              <span class="arch" title="${esc(e.archivo)}">${esc(e.archivo)}</span>
            </figcaption>
          </figure>`
          )
          .join('')}
      </div>
    </div>`;

  const bloqueProducto = (p) => `
    <section class="producto">
      <h3><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.nombre || p.slug)}</a></h3>
      <p class="meta">${p.entradasGaleria} entradas de galeria &middot; ${p.archivosUnicos} archivos unicos &middot;
        <b class="rojo">${p.archivosDuplicados} repetidas</b> &middot; <code>${esc(p.slug)}</code></p>
      ${p.grupos.map(bloqueGrupo).join('')}
    </section>`;

  const html = `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NGC — hoja de contacto de fotos repetidas</title>
<style>
:root{--navy:#0B1327;--navy2:#133C5C;--oro:#D8B868;--verde:#2ecc71;--rojo:#e74c3c;--txt:#e9eef5;--gris:#9fb0c4}
*{box-sizing:border-box}
body{margin:0;background:var(--navy);color:var(--txt);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{padding:24px 20px;border-top:4px solid var(--oro);background:linear-gradient(160deg,var(--navy) 0%,var(--navy2) 55%,#071021 100%)}
h1{margin:0 0 4px;font-size:22px;letter-spacing:.02em}
header .sub{color:var(--oro);font-size:12px;letter-spacing:.14em;text-transform:uppercase}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;padding:18px 20px}
.kpi{background:rgba(255,255,255,.05);border:1px solid rgba(216,184,104,.25);border-radius:10px;padding:12px 14px}
.kpi b{display:block;font-size:26px;line-height:1.15;color:#fff}
.kpi span{color:var(--gris);font-size:11px;text-transform:uppercase;letter-spacing:.08em}
main{padding:0 20px 60px;max-width:1400px}
h2{margin:34px 0 6px;font-size:16px;color:var(--oro);letter-spacing:.06em;text-transform:uppercase}
.nota{color:var(--gris);margin:0 0 14px;font-size:13px}
.producto{border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:14px 16px;margin:0 0 16px;background:rgba(255,255,255,.03)}
.producto h3{margin:0 0 2px;font-size:16px}
.producto h3 a{color:#fff;text-decoration:none;border-bottom:1px dotted var(--oro)}
.meta{margin:0 0 12px;color:var(--gris);font-size:12px}
.meta code{color:var(--oro)}
.rojo{color:var(--rojo)}
.grupo{border-top:1px solid rgba(255,255,255,.08);padding:12px 0 4px}
.grupo-cab{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px}
.hash{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--oro)}
.cuenta{font-size:12px;color:var(--gris)}
.tira{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px}
figure{margin:0;flex:0 0 148px;border-radius:8px;overflow:hidden;background:#fff;border:3px solid transparent}
figure.queda{border-color:var(--verde)}
figure.sobra{border-color:var(--rojo)}
figure img{display:block;width:100%;height:148px;object-fit:contain;background:#fff}
figcaption{background:#0d1626;padding:6px 7px;display:flex;flex-direction:column;gap:1px;font-size:10.5px;color:var(--gris)}
figure.queda figcaption b{color:var(--verde)}
figure.sobra figcaption b{color:var(--rojo)}
.arch{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.75}
details{border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 14px;background:rgba(255,255,255,.02)}
summary{cursor:pointer;color:var(--oro)}
table{border-collapse:collapse;width:100%;margin-top:10px;font-size:12.5px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.08)}
th{color:var(--gris);font-weight:600;text-transform:uppercase;font-size:10.5px;letter-spacing:.06em}
</style></head>
<body>
<header>
  <div class="sub">NGC Tienda Aeronautica</div>
  <h1>Hoja de contacto — fotos repetidas byte a byte</h1>
  <div class="nota">${esc(informe.meta.tienda)} &middot; ${esc(informe.meta.generadoEn)} &middot; huella <code>${esc(informe.meta.huella.slice(0, 16))}</code></div>
</header>

<div class="kpis">
  <div class="kpi"><b>${r.productos}</b><span>productos</span></div>
  <div class="kpi"><b>${r.entradasGaleria}</b><span>entradas de galeria</span></div>
  <div class="kpi"><b>${r.archivosDuplicados}</b><span>archivos duplicados</span></div>
  <div class="kpi"><b>${r.productosConDuplicados}</b><span>productos afectados</span></div>
  <div class="kpi"><b>${r.resolucion.maximo ?? '?'}</b><span>ancho maximo px</span></div>
  <div class="kpi"><b>${r.cuadradas}/${r.entradasGaleria}</b><span>cuadradas</span></div>
</div>

<main>
  <h2>Repetidas — que borrar</h2>
  <p class="nota">Cada tira es un grupo de archivos con el mismo SHA-256 dentro del mismo producto.
     La primera (verde) es la que se queda; las rojas sobran. La repeticion por variante
     tambien aparece aca: si el producto tiene 5 variantes con la misma foto, vas a ver 5 copias.</p>
  ${conDup.length ? conDup.map(bloqueProducto).join('') : '<p class="nota">Ningun producto tiene archivos repetidos.</p>'}

  <h2>Resolucion de los archivos</h2>
  <table>
    <tr><th>Metrica</th><th>Valor</th></tr>
    <tr><td>archivos medidos</td><td>${r.resolucion.medidas}</td></tr>
    <tr><td>ancho menor a 400 px</td><td>${r.resolucion.menorA400}</td></tr>
    <tr><td>ancho menor a 600 px</td><td>${r.resolucion.menorA600}</td></tr>
    <tr><td>ancho menor a 800 px</td><td>${r.resolucion.menorA800}</td></tr>
    <tr><td>mediana de ancho</td><td>${r.resolucion.mediana ?? '?'} px</td></tr>
    <tr><td>ancho maximo de toda la tienda</td><td><b>${r.resolucion.maximo ?? '?'} px</b></td></tr>
    <tr><td>cuadradas</td><td>${r.cuadradas} de ${r.entradasGaleria}</td></tr>
    <tr><td>nombres de archivo sin descripcion</td><td>${r.nombresSinDescripcion}</td></tr>
  </table>

  <h2>Productos sin repetidas (${sinDup.length})</h2>
  <details><summary>ver lista</summary>
    <table><tr><th>producto</th><th>fotos</th><th>ancho max</th></tr>
    ${sinDup
      .map((p) => {
        const anchos = p.entradas.map((e) => e.ancho).filter(Boolean);
        return `<tr><td><a href="${esc(p.url)}" target="_blank" rel="noopener" style="color:#fff">${esc(p.nombre || p.slug)}</a></td><td>${p.entradasGaleria}</td><td>${anchos.length ? Math.max(...anchos) : '?'}</td></tr>`;
      })
      .join('')}
    </table>
  </details>

  ${
    informe.errores.length
      ? `<h2>Errores (${informe.errores.length})</h2><details><summary>ver</summary><table><tr><th>tipo</th><th>url</th><th>detalle</th></tr>${informe.errores
          .map((e) => `<tr><td>${esc(e.tipo)}</td><td>${esc(e.url)}</td><td>${esc(e.detalle || '')}</td></tr>`)
          .join('')}</table></details>`
      : ''
  }
</main>
</body></html>`;

  fs.writeFileSync(destino, html);
}
