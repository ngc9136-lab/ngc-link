/**
 * Backend de "Mis Finanzas" en Google Apps Script.
 *
 * Se publica como aplicación web (Implementar > Nueva implementación > Aplicación web,
 * ejecutar como "Yo", acceso "Cualquier persona"). La app llama:
 *   GET  ?action=ping|all|cotizaciones&token=...
 *   POST cuerpo JSON (Content-Type text/plain): { token, ops: [ {op:'upsert', hoja, row} | {op:'delete', hoja, id} ] }
 *
 * Seguridad: si definís la propiedad de script TOKEN (Configuración del proyecto >
 * Propiedades de la secuencia de comandos), toda llamada tiene que traer esa misma clave.
 */

/** Versión del script: la app avisa si hay que actualizarlo. */
var VERSION_SCRIPT = 4;

/** Encabezados de cada hoja de datos. La columna "id" identifica cada fila. */
var ESQUEMA = {
  Ingresos: ['id', 'fecha', 'concepto', 'categoria', 'monto', 'moneda', 'tipo', 'balde', 'nota', 'actualizado'],
  Gastos: ['id', 'fecha', 'categoria', 'descripcion', 'monto', 'moneda', 'medio', 'ambito', 'fijo', 'devuelto', 'fechaDevolucion', 'actualizado'],
  Cuotas: ['id', 'descripcion', 'medio', 'montoCuota', 'moneda', 'cuotasTotales', 'mesPrimeraCuota', 'ambito', 'actualizado'],
  Inversiones: ['id', 'activo', 'tipo', 'plataforma', 'cantidad', 'precioCompra', 'monedaCompra', 'tcCompra', 'fechaCompra', 'balde', 'plan', 'notaPlan', 'actualizado'],
  Vencimientos: ['id', 'concepto', 'monto', 'moneda', 'fecha', 'medio', 'estado', 'origen', 'ref', 'actualizado'],
  Objetivos: ['id', 'balde', 'nombre', 'meta', 'moneda', 'saldoInicial', 'fechaMeta', 'actualizado'],
  Historial: ['id', 'fecha', 'patrimonioARS', 'patrimonioUSD', 'dolar', 'actualizado']
};
var HOJAS_DATOS = Object.keys(ESQUEMA);

/** Tipos de columna: se usan para guardar y leer con el formato correcto. */
var COL_FECHA = ['fecha', 'fechaDevolucion', 'fechaCompra', 'fechaMeta'];
var COL_TEXTO = ['id', 'mesPrimeraCuota', 'actualizado', 'ref', 'activo'];
var COL_NUMERO = ['monto', 'montoCuota', 'cuotasTotales', 'cantidad', 'precioCompra', 'tcCompra', 'meta',
  'saldoInicial', 'patrimonioARS', 'patrimonioUSD', 'dolar'];

/** Hoja de cotizaciones de mercado (GOOGLEFINANCE). */
var COTIZ_HOJA = 'Cotizaciones';
var COTIZ_ENCABEZADOS = ['simbolo', 'ticker', 'precio', 'moneda', 'actualizado'];
var COTIZ_INICIALES = [
  ['VOO', 'NYSEARCA:VOO', 'USD'], ['VT', 'NYSEARCA:VT', 'USD'], ['SPY', 'NYSEARCA:SPY', 'USD'],
  ['SGOV', 'NYSEARCA:SGOV', 'USD'], ['BIL', 'NYSEARCA:BIL', 'USD'], ['SCHD', 'NYSEARCA:SCHD', 'USD'],
  ['IB01', 'LON:IB01', 'USD']
];

/* ======================= Puntos de entrada ======================= */

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    verificarToken_(p.token);
    var accion = p.action || 'all';
    if (accion === 'ping') return json_({ ok: true, version: VERSION_SCRIPT, hora: new Date().toISOString() });
    if (accion === 'cotizaciones') return json_({ ok: true, version: VERSION_SCRIPT, cotizaciones: leerCotizaciones_(), hora: new Date().toISOString() });
    if (accion === 'all') {
      var data = {};
      HOJAS_DATOS.forEach(function (h) { data[h] = leerHoja_(h); });
      return json_({ ok: true, version: VERSION_SCRIPT, data: data, cotizaciones: leerCotizaciones_(), hora: new Date().toISOString() });
    }
    throw new Error('Acción desconocida: ' + accion);
  } catch (err) {
    return json_({ ok: false, error: mensaje_(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var cuerpo = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    verificarToken_(cuerpo.token);
    var ops = cuerpo.ops || [];
    if (!Array.isArray(ops)) throw new Error('El campo ops tiene que ser una lista.');
    if (ops.length > 200) throw new Error('Demasiadas operaciones juntas (máximo 200).');
    lock.waitLock(20000); // evita que dos dispositivos escriban a la vez
    var tocadas = {};
    var resultados = ops.map(function (op) {
      try {
        aplicarOp_(op);
        tocadas[op.hoja] = true;
        return { ok: true, id: op.row ? op.row.id : op.id };
      } catch (err) {
        return { ok: false, id: op && (op.row ? op.row.id : op.id), error: mensaje_(err) };
      }
    });
    Object.keys(tocadas).forEach(ordenarHoja_);
    SpreadsheetApp.flush();
    return json_({ ok: true, resultados: resultados });
  } catch (err) {
    return json_({ ok: false, error: mensaje_(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* sin lock tomado */ }
  }
}

/** Menú en la planilla para crear las hojas a mano. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Finanzas').addItem('Preparar hojas', 'prepararHojas').addToUi();
}

/** Crea todas las hojas faltantes. Ejecutala una vez desde el editor para autorizar el script. */
function prepararHojas() {
  HOJAS_DATOS.forEach(asegurarHoja_);
  asegurarCotizaciones_();
}

/* ======================= Operaciones ======================= */

function aplicarOp_(op) {
  if (!op || !ESQUEMA[op.hoja]) throw new Error('Hoja inválida: ' + (op && op.hoja));
  var hoja = asegurarHoja_(op.hoja);
  var cols = encabezados_(hoja);
  if (op.op === 'upsert') {
    var row = op.row || {};
    if (!row.id) throw new Error('Falta el id de la fila.');
    validarFila_(op.hoja, row);
    var valores = cols.map(function (c) { return aCelda_(c, row[c]); });
    var fila = buscarFila_(hoja, row.id);
    if (fila < 0) fila = hoja.getLastRow() + 1;
    hoja.getRange(fila, 1, 1, cols.length).setValues([valores]);
  } else if (op.op === 'delete') {
    if (!op.id) throw new Error('Falta el id a borrar.');
    var f = buscarFila_(hoja, op.id);
    if (f > 0) hoja.deleteRow(f);
  } else {
    throw new Error('Operación desconocida: ' + op.op);
  }
}

/** Validaciones mínimas del lado del servidor (la app valida todo en detalle). */
function validarFila_(nombre, row) {
  COL_NUMERO.forEach(function (c) {
    if (row[c] !== undefined && row[c] !== '' && row[c] !== null && !isFinite(Number(row[c]))) {
      throw new Error('El campo ' + c + ' tiene que ser un número.');
    }
  });
  COL_FECHA.forEach(function (c) {
    if (row[c] && !/^\d{4}-\d{2}-\d{2}$/.test(String(row[c]))) throw new Error('Fecha inválida en ' + c + ': ' + row[c]);
  });
  if (row.mesPrimeraCuota && !/^\d{4}-\d{2}$/.test(String(row.mesPrimeraCuota))) throw new Error('Mes inválido: ' + row.mesPrimeraCuota);
}

/** Busca el número de fila (1-based) de un id; -1 si no existe. */
function buscarFila_(hoja, id) {
  var n = hoja.getLastRow() - 1;
  if (n < 1) return -1;
  var ids = hoja.getRange(2, 1, n, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

/** Ordena por fecha (ascendente) las hojas que tienen columna "fecha". */
function ordenarHoja_(nombre) {
  var hoja = SpreadsheetApp.getActive().getSheetByName(nombre);
  if (!hoja || hoja.getLastRow() < 3) return;
  var col = encabezados_(hoja).indexOf('fecha');
  if (col < 0) return;
  hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).sort({ column: col + 1, ascending: true });
}

/* ======================= Lectura ======================= */

function leerHoja_(nombre) {
  var hoja = asegurarHoja_(nombre);
  var n = hoja.getLastRow() - 1;
  if (n < 1) return [];
  var cols = encabezados_(hoja);
  var valores = hoja.getRange(2, 1, n, cols.length).getValues();
  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  var filas = [];
  valores.forEach(function (v) {
    if (v[0] === '' || v[0] === null) return; // filas sin id se ignoran
    var o = {};
    cols.forEach(function (c, i) { if (c) o[c] = deCelda_(c, v[i], tz); });
    filas.push(o);
  });
  return filas;
}

function leerCotizaciones_() {
  var hoja = asegurarCotizaciones_();
  agregarSimbolosFaltantes_(hoja);
  var n = hoja.getLastRow() - 1;
  if (n < 1) return [];
  var rango = hoja.getRange(2, 1, n, 5);
  var formulas = rango.getFormulas();
  var vals = rango.getValues();
  // Pone (o corrige) la fórmula de precio en cada fila con ticker.
  // Se usa GOOGLEFINANCE con un solo argumento para que funcione en cualquier
  // configuración regional (en Argentina el separador de argumentos es ";").
  var cambio = false;
  for (var i = 0; i < n; i++) {
    var f = i + 2;
    var esperada = formulaPrecio_(f);
    var actual = String(formulas[i][2] || '').replace(/\s/g, '').toUpperCase();
    var manual = !formulas[i][2] && typeof vals[i][2] === 'number' && vals[i][2] > 0; // precio escrito a mano
    if (vals[i][1] && !manual && actual !== esperada.toUpperCase()) {
      hoja.getRange(f, 3).setFormula(esperada);
      if (formulas[i][4]) hoja.getRange(f, 5).setValue(''); // fórmula vieja de hora: se reemplaza por la hora de lectura
      cambio = true;
    }
  }
  if (cambio) { SpreadsheetApp.flush(); vals = rango.getValues(); }
  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  var ahora = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
  return vals.filter(function (v) { return v[0]; }).map(function (v) {
    var precio = typeof v[2] === 'number' && isFinite(v[2]) && v[2] > 0 ? v[2] : null;
    var act = v[4] instanceof Date ? Utilities.formatDate(v[4], tz, "yyyy-MM-dd'T'HH:mm:ssXXX") : (v[4] ? String(v[4]) : ahora);
    return { simbolo: String(v[0]).trim().toUpperCase(), ticker: String(v[1] || ''), precio: precio, moneda: String(v[3] || 'USD').toUpperCase(), actualizado: act };
  });
}

/**
 * Agrega a Cotizaciones cada acción, ETF o CEDEAR cargado en Inversiones que todavía no tenga fila.
 * Acciones y ETF: ticker = símbolo, en dólares. CEDEAR: ticker BCBA:símbolo, en pesos.
 */
function agregarSimbolosFaltantes_(hoja) {
  var inv = SpreadsheetApp.getActive().getSheetByName('Inversiones');
  if (!inv || inv.getLastRow() < 2) return;
  var cols = encabezados_(inv);
  var ia = cols.indexOf('activo'), it = cols.indexOf('tipo');
  if (ia < 0 || it < 0) return;
  var filas = inv.getRange(2, 1, inv.getLastRow() - 1, cols.length).getValues();
  var n = hoja.getLastRow() - 1;
  var existentes = n > 0 ? hoja.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]).trim().toUpperCase(); }) : [];
  filas.forEach(function (r) {
    var tipo = String(r[it]), sym = String(r[ia]).trim().toUpperCase();
    if (['accion', 'etf', 'cedear'].indexOf(tipo) < 0 || !sym || existentes.indexOf(sym) >= 0) return;
    existentes.push(sym);
    var f = hoja.getLastRow() + 1;
    hoja.getRange(f, 1, 1, 2).setValues([[sym, tipo === 'cedear' ? 'BCBA:' + sym : sym]]);
    hoja.getRange(f, 3).setFormula(formulaPrecio_(f));
    hoja.getRange(f, 4).setValue(tipo === 'cedear' ? 'ARS' : 'USD');
  });
}

/** Fórmula de precio sin separadores de argumentos (sirve con coma o con punto y coma). */
function formulaPrecio_(fila) {
  return '=IFERROR(GOOGLEFINANCE(B' + fila + '))';
}

/* ======================= Hojas y formatos ======================= */

function asegurarHoja_(nombre) {
  var ss = SpreadsheetApp.getActive();
  var hoja = ss.getSheetByName(nombre);
  var esperados = ESQUEMA[nombre];
  if (!hoja) {
    hoja = ss.insertSheet(nombre);
    hoja.getRange(1, 1, 1, esperados.length).setValues([esperados]);
    darFormato_(hoja, esperados);
    return hoja;
  }
  // Si faltan columnas (versión vieja de la hoja), se agregan al final.
  var actuales = encabezados_(hoja);
  var faltan = esperados.filter(function (c) { return actuales.indexOf(c) < 0; });
  if (faltan.length) {
    hoja.getRange(1, actuales.length + 1, 1, faltan.length).setValues([faltan]);
    darFormato_(hoja, encabezados_(hoja));
  }
  return hoja;
}

function darFormato_(hoja, cols) {
  hoja.setFrozenRows(1);
  hoja.getRange(1, 1, 1, cols.length).setFontWeight('bold').setBackground('#1c2430').setFontColor('#ffffff');
  var filas = Math.max(hoja.getMaxRows() - 1, 1);
  cols.forEach(function (c, i) {
    var r = hoja.getRange(2, i + 1, filas, 1);
    if (COL_FECHA.indexOf(c) >= 0) r.setNumberFormat('yyyy-mm-dd');
    else if (COL_TEXTO.indexOf(c) >= 0) r.setNumberFormat('@');
    else if (COL_NUMERO.indexOf(c) >= 0) r.setNumberFormat('#,##0.########');
  });
}

function asegurarCotizaciones_() {
  var ss = SpreadsheetApp.getActive();
  var hoja = ss.getSheetByName(COTIZ_HOJA);
  if (hoja) return hoja;
  hoja = ss.insertSheet(COTIZ_HOJA);
  hoja.getRange(1, 1, 1, COTIZ_ENCABEZADOS.length).setValues([COTIZ_ENCABEZADOS]);
  hoja.setFrozenRows(1);
  hoja.getRange(1, 1, 1, COTIZ_ENCABEZADOS.length).setFontWeight('bold').setBackground('#1c2430').setFontColor('#ffffff');
  COTIZ_INICIALES.forEach(function (c, i) {
    var f = i + 2;
    hoja.getRange(f, 1, 1, 2).setValues([[c[0], c[1]]]);
    hoja.getRange(f, 3).setFormula(formulaPrecio_(f));
    hoja.getRange(f, 4).setValue(c[2]);
  });
  return hoja;
}

function encabezados_(hoja) {
  var n = hoja.getLastColumn();
  if (n < 1) return [];
  return hoja.getRange(1, 1, 1, n).getValues()[0].map(function (h) { return String(h).trim(); });
}

/* ======================= Conversión de valores ======================= */

function aCelda_(col, v) {
  if (v === undefined || v === null) return '';
  if (COL_FECHA.indexOf(col) >= 0) {
    if (!v) return '';
    var p = String(v).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  if (COL_NUMERO.indexOf(col) >= 0) return v === '' ? '' : Number(v);
  return String(v);
}

function deCelda_(col, v, tz) {
  if (v instanceof Date) {
    if (col === 'mesPrimeraCuota') return Utilities.formatDate(v, tz, 'yyyy-MM');
    if (col === 'actualizado') return Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  if (COL_NUMERO.indexOf(col) >= 0) return v === '' ? '' : Number(v);
  return v === null ? '' : String(v);
}

/* ======================= Auxiliares ======================= */

function verificarToken_(token) {
  var esperado = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (esperado && String(token || '') !== esperado) throw new Error('Clave inválida. Revisá la clave en Ajustes.');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function mensaje_(err) {
  return String((err && err.message) || err);
}
