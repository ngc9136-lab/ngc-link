#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Pipeline de preparacion de fotos para volver a subir al panel de Tiendanube.
//
//   node prep-photos.mjs --entrada ~/fotos-originales --salida fotos-listas
//
// Estructura esperada de --entrada: una carpeta por producto.
//
//   fotos-originales/
//     parche-jerarquia-faa-cabo-primero/
//       IMG_2841.jpg
//       sin-titulo-1500-x-1500-px.png
//     gorra-faa/
//       ...
//
// Que hace, en orden:
//   1. Deduplica por SHA-256 antes de tocar nada.
//   2. Descarta (sin borrar) las que no llegan al minimo: van a
//      volver-a-fotografiar.csv. No se agranda ningun archivo.
//   3. Recorta el borde uniforme, encaja el producto en un cuadrado de 1600
//      con 8% de margen y fondo blanco.
//   4. Renombra en kebab-case descriptivo.
//   5. Deja una carpeta por producto lista para arrastrar al panel.
//
// Es idempotente: si volves a correrlo, saltea lo ya exportado.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('Falta sharp. Instalalo con:\n  npm i -D sharp');
  process.exit(1);
}

const EXT_IMAGEN = /\.(jpe?g|png|webp|tiff?|avif|heic|heif)$/i;

function parsearArgs(argv) {
  const a = {
    entrada: null,
    salida: path.resolve('fotos-listas'),
    lado: 1600,
    margen: 0.08,
    minimo: null, // por defecto = lado
    calidad: 88,
    recortar: true,
    umbralRecorte: 12,
    forzar: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--entrada') a.entrada = path.resolve(argv[++i]);
    else if (t === '--salida') a.salida = path.resolve(argv[++i]);
    else if (t === '--lado') a.lado = parseInt(argv[++i], 10);
    else if (t === '--margen') a.margen = parseFloat(argv[++i]);
    else if (t === '--minimo') a.minimo = parseInt(argv[++i], 10);
    else if (t === '--calidad') a.calidad = parseInt(argv[++i], 10);
    else if (t === '--sin-recorte') a.recortar = false;
    else if (t === '--umbral-recorte') a.umbralRecorte = parseInt(argv[++i], 10);
    else if (t === '--forzar') a.forzar = true;
    else if (t === '--help' || t === '-h') {
      console.log(AYUDA);
      process.exit(0);
    }
  }
  if (a.minimo === null) a.minimo = a.lado;
  return a;
}

const AYUDA = `
Preparacion de fotos para Tiendanube

  node prep-photos.mjs --entrada DIR [opciones]

  --entrada DIR        carpeta con los originales (una subcarpeta por producto)
  --salida DIR         carpeta de destino (default ./fotos-listas)
  --lado N             lado del cuadrado final (default 1600)
  --margen F           margen uniforme, fraccion del lado (default 0.08 = 8%)
  --minimo N           lado minimo del original para exportarlo (default = --lado).
                       Por debajo de eso va a volver-a-fotografiar.csv sin tocarse.
  --calidad N          calidad JPEG (default 88)
  --sin-recorte        no recortar el borde uniforme antes de encuadrar
  --umbral-recorte N   tolerancia del recorte (default 12)
  --forzar             rehacer los archivos ya exportados
`;

// --- nombres ---------------------------------------------------------------
const SIN_VALOR = /^(sin[-_ ]?titulo|imagen|image|img|foto|photo|dsc|dscn|whatsapp|screenshot|captura|untitled|copia|copy)(-|\d|$)/i;

export function kebab(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** Se queda con la parte descriptiva del nombre original, si la hay. */
export function trozoUtil(nombreArchivo) {
  const base = nombreArchivo.replace(EXT_IMAGEN, '');
  const limpio = kebab(base)
    // ruido tipico del panel y de las camaras
    .replace(/\b\d{3,4}\s*-?\s*x\s*-?\s*\d{3,4}\b/g, '')
    .replace(/\bpx\b/g, '')
    .replace(/\b(19|20)\d{2}-?\d{2}-?\d{2}\b/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!limpio) return '';
  if (SIN_VALOR.test(limpio)) return '';
  if (/^[\d-]+$/.test(limpio)) return '';
  return limpio.split('-').slice(0, 5).join('-');
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function listarProductos(entrada) {
  const items = fs.readdirSync(entrada, { withFileTypes: true });
  const carpetas = items.filter((d) => d.isDirectory()).map((d) => d.name);
  const sueltas = items.filter((d) => d.isFile() && EXT_IMAGEN.test(d.name)).map((d) => d.name);
  const productos = carpetas.map((c) => ({
    producto: kebab(c),
    carpeta: path.join(entrada, c),
    archivos: fs
      .readdirSync(path.join(entrada, c))
      .filter((f) => EXT_IMAGEN.test(f))
      .sort((a, b) => a.localeCompare(b, 'es', { numeric: true })),
  }));
  if (sueltas.length) {
    productos.push({
      producto: 'sin-producto',
      carpeta: entrada,
      archivos: sueltas.sort((a, b) => a.localeCompare(b, 'es', { numeric: true })),
    });
  }
  return productos.filter((p) => p.archivos.length).sort((a, b) => a.producto.localeCompare(b.producto));
}

async function main() {
  const a = parsearArgs(process.argv);
  if (!a.entrada) {
    console.error('Falta --entrada con la carpeta de originales.\n' + AYUDA);
    process.exit(2);
  }
  if (!fs.existsSync(a.entrada)) {
    console.error('No existe la carpeta ' + a.entrada);
    process.exit(2);
  }

  const cajaContenido = Math.round(a.lado * (1 - 2 * a.margen));
  console.log(`> entrada  ${a.entrada}`);
  console.log(`> salida   ${a.salida}`);
  console.log(`> lienzo   ${a.lado}x${a.lado} blanco, contenido max ${cajaContenido}px (margen ${(a.margen * 100).toFixed(0)}%)`);
  console.log(`> minimo   ${a.minimo}px de lado mayor en el original\n`);

  fs.mkdirSync(a.salida, { recursive: true });
  const manifiestoPath = path.join(a.salida, 'manifiesto.json');
  const manifiesto =
    !a.forzar && fs.existsSync(manifiestoPath)
      ? JSON.parse(fs.readFileSync(manifiestoPath, 'utf8'))
      : { archivos: {} };

  const exportados = [];
  const chicas = [];
  const productoChico = [];

  // El archivo pasa el minimo pero, una vez recortado el aire, el producto en si
  // no llena la caja de contenido. Agrandarlo seria inventar pixeles, asi que se
  // exporta con mas margen y se avisa. Se evalua tambien sobre lo cacheado, para
  // que el informe no pierda el aviso al volver a correr.
  const revisarProductoChico = (reg) => {
    const ladoContenido = Math.max(reg.anchoContenido, reg.altoContenido);
    if (ladoContenido >= cajaContenido) return;
    productoChico.push({
      producto: reg.producto,
      archivo: reg.archivoOrigen,
      origen: reg.origen,
      ancho: reg.anchoOrigen,
      alto: reg.altoOrigen,
      ladoMayor: Math.max(reg.anchoOrigen, reg.altoOrigen),
      faltan: cajaContenido - ladoContenido,
      exportada: 'si',
      motivo: `el producto recortado mide ${ladoContenido}px y la caja pide ${cajaContenido}px; queda con ${reg.margenReal}% de margen en vez de ${(a.margen * 100).toFixed(0)}%`,
    });
  };
  const duplicadas = [];
  const errores = [];

  for (const p of listarProductos(a.entrada)) {
    const dirProducto = path.join(a.salida, p.producto);
    const vistos = new Map(); // sha256 -> primer archivo
    let n = 0;

    for (const archivo of p.archivos) {
      const origen = path.join(p.carpeta, archivo);
      let bytes;
      try {
        bytes = fs.readFileSync(origen);
      } catch (err) {
        errores.push({ origen, motivo: 'no se pudo leer', detalle: String(err.message) });
        continue;
      }
      const hash = sha256(bytes);

      // 1. deduplicar por SHA-256, antes de tocar nada
      if (vistos.has(hash)) {
        duplicadas.push({ producto: p.producto, sha256: hash, seQueda: vistos.get(hash), descartada: archivo });
        continue;
      }
      vistos.set(hash, archivo);

      let meta;
      try {
        meta = await sharp(bytes).metadata();
      } catch (err) {
        errores.push({ origen, motivo: 'no es una imagen legible', detalle: String(err.message) });
        continue;
      }
      // la orientacion EXIF puede tener el ancho y el alto intercambiados
      const rotado = meta.orientation && meta.orientation >= 5;
      const ancho = rotado ? meta.height : meta.width;
      const alto = rotado ? meta.width : meta.height;
      const ladoMayor = Math.max(ancho || 0, alto || 0);

      // 2. sin inventar pixeles
      if (ladoMayor < a.minimo) {
        chicas.push({
          producto: p.producto,
          archivo,
          origen,
          ancho,
          alto,
          ladoMayor,
          faltan: a.minimo - ladoMayor,
          exportada: 'no',
          motivo: `el archivo mide ${ladoMayor}px de lado mayor, no llega a ${a.minimo}px`,
        });
        continue;
      }

      n++;
      const trozo = trozoUtil(archivo);
      const destinoNombre = [p.producto, trozo, String(n).padStart(2, '0')].filter(Boolean).join('-') + '.jpg';
      const destino = path.join(dirProducto, destinoNombre);

      const yaHecho = manifiesto.archivos[destino];
      if (!a.forzar && yaHecho && yaHecho.sha256Origen === hash && fs.existsSync(destino)) {
        exportados.push({ ...yaHecho, destino, salteado: true });
        revisarProductoChico(yaHecho);
        continue;
      }

      fs.mkdirSync(dirProducto, { recursive: true });
      try {
        let img = sharp(bytes, { failOn: 'none' }).rotate(); // aplica la orientacion EXIF
        if (a.recortar) {
          // recorta el borde uniforme para que el margen final sea real y no
          // el aire que ya traia la foto
          try {
            img = sharp(await img.trim({ threshold: a.umbralRecorte }).toBuffer(), { failOn: 'none' });
          } catch {
            img = sharp(bytes, { failOn: 'none' }).rotate();
          }
        }
        const contenido = await img
          .resize({
            width: cajaContenido,
            height: cajaContenido,
            fit: 'inside',
            withoutEnlargement: true, // nunca se agranda: cero pixeles inventados
          })
          .toBuffer({ resolveWithObject: true });

        await sharp({
          create: { width: a.lado, height: a.lado, channels: 3, background: '#ffffff' },
        })
          .composite([{ input: contenido.data, gravity: 'centre' }])
          .jpeg({ quality: a.calidad, chromaSubsampling: '4:4:4', mozjpeg: true })
          .toFile(destino);

        const reg = {
          producto: p.producto,
          origen,
          archivoOrigen: archivo,
          sha256Origen: hash,
          anchoOrigen: ancho,
          altoOrigen: alto,
          anchoContenido: contenido.info.width,
          altoContenido: contenido.info.height,
          margenReal: Number((((a.lado - Math.max(contenido.info.width, contenido.info.height)) / 2 / a.lado) * 100).toFixed(1)),
          bytesSalida: fs.statSync(destino).size,
        };
        manifiesto.archivos[destino] = reg;
        exportados.push({ ...reg, destino, salteado: false });

        revisarProductoChico(reg);
      } catch (err) {
        errores.push({ origen, motivo: 'fallo el procesamiento', detalle: String(err.message) });
      }
    }
  }

  // --- salidas -------------------------------------------------------------
  fs.writeFileSync(manifiestoPath, JSON.stringify(manifiesto, null, 2));

  const csv = (filas, cab) =>
    [cab.join(','), ...filas.map((f) => cab.map((c) => `"${String(f[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n') + '\n';

  const pathChicas = path.join(a.salida, 'volver-a-fotografiar.csv');
  const aRefotografiar = [...chicas, ...productoChico].sort(
    (x, y) => x.producto.localeCompare(y.producto) || x.archivo.localeCompare(y.archivo)
  );
  fs.writeFileSync(
    pathChicas,
    csv(aRefotografiar, ['producto', 'archivo', 'ancho', 'alto', 'ladoMayor', 'faltan', 'exportada', 'motivo', 'origen'])
  );
  const pathDup = path.join(a.salida, 'duplicados.csv');
  fs.writeFileSync(pathDup, csv(duplicadas, ['producto', 'sha256', 'seQueda', 'descartada']));

  const informe = {
    meta: { generadoEn: new Date().toISOString(), entrada: a.entrada, salida: a.salida, lado: a.lado, margen: a.margen, minimo: a.minimo },
    resumen: {
      exportadas: exportados.length,
      salteadasPorCache: exportados.filter((e) => e.salteado).length,
      duplicadasDescartadas: duplicadas.length,
      noExportadasPorChicas: chicas.length,
      exportadasConProductoChico: productoChico.length,
      aVolverAFotografiar: chicas.length + productoChico.length,
      errores: errores.length,
      margenRealMinimo: exportados.length ? Math.min(...exportados.filter((e) => e.margenReal != null).map((e) => e.margenReal)) : null,
    },
    exportados,
    duplicadas,
    chicas,
    productoChico,
    errores,
  };
  fs.writeFileSync(path.join(a.salida, 'informe-preparacion.json'), JSON.stringify(informe, null, 2));

  const r = informe.resumen;
  console.log('  exportadas ........................ ' + r.exportadas + (r.salteadasPorCache ? ` (${r.salteadasPorCache} ya estaban)` : ''));
  console.log('  duplicadas descartadas (SHA-256) .. ' + r.duplicadasDescartadas);
  console.log('  a volver a fotografiar ............ ' + r.aVolverAFotografiar +
    ` (${r.noExportadasPorChicas} no llegan al minimo, ${r.exportadasConProductoChico} con el producto chico en el cuadro)`);
  console.log('  errores ........................... ' + r.errores);
  console.log('');
  console.log('  ' + pathChicas);
  console.log('  ' + pathDup);
  console.log('  ' + path.join(a.salida, 'informe-preparacion.json'));
  if (errores.length) for (const e of errores.slice(0, 5)) console.log('  ! ' + e.origen + ' — ' + e.motivo);
}

if (process.argv[1] && process.argv[1].endsWith('prep-photos.mjs')) {
  main().catch((err) => {
    console.error('FALLO:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
