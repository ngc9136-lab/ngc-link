# Mis Finanzas: PWA de ahorro, gastos e inversiones

App web instalable en Android, en español rioplatense y con tema oscuro, para registrar ingresos, gastos, cuotas, inversiones, vencimientos y objetivos de ahorro. Los datos viven en **tu Google Sheet**, las tenencias se valúan a precio de mercado en pesos y en dólares, y la app funciona **sin conexión**: guarda los cambios en el celular y los sincroniza al volver la red.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Toda la app (HTML, CSS y JavaScript comentados). Usa Chart.js 4.4.1 desde cdnjs. |
| `manifest.webmanifest` | Manifiesto de la PWA (nombre, íconos, colores). |
| `sw.js` | Service worker: guarda la app y Chart.js en caché para abrirla sin conexión. |
| `apps-script/Code.gs` | Backend en Google Apps Script (`doGet` y `doPost`). |
| `icons/` | Íconos PNG generados por código. |
| `tools/generar-iconos.mjs` | Script que genera los íconos (`node tools/generar-iconos.mjs`, sin dependencias). |

---

## 1. Crear la hoja de cálculo

1. Entrá a [sheets.new](https://sheets.new) y creá una planilla nueva, por ejemplo "Finanzas".
2. En **Archivo > Configuración**, poné la zona horaria en `(GMT-03:00) Buenos Aires` y la configuración regional en `Argentina`.
3. No hace falta crear las hojas a mano: el script las crea con sus encabezados la primera vez que la app se conecta. También podés crearlas desde el menú **Finanzas > Preparar hojas**, que aparece después del paso 2.

### Estructura de cada hoja

La primera fila tiene los encabezados. La columna `id` identifica cada fila y la genera la app: no la cambies. Las fechas usan el formato `aaaa-mm-dd`. Podés editar los datos directamente en la hoja, y la app los toma en la próxima sincronización.

**Ingresos**
| Columna | Contenido |
|---|---|
| id | Identificador único |
| fecha | Fecha del ingreso |
| concepto | Texto libre, por ejemplo "Sueldo septiembre" |
| categoria | `Sueldo`, `Horas extras`, `Bono`, `Aguinaldo`, `Negocio`, `Otro` |
| monto | Número |
| moneda | `ARS` o `USD` |
| tipo | `fijo` o `variable` |
| balde | Balde de destino (solo variables): `emergencia`, `vivienda`, `vacaciones`, `inversion` o vacío |
| nota | Opcional |
| actualizado | Fecha y hora de la última modificación (la completa la app) |

**Gastos**
| Columna | Contenido |
|---|---|
| id, fecha | Igual que en Ingresos |
| categoria | Supermercado, Servicios, Alquiler y expensas, Transporte, Salud, etc. |
| descripcion | Texto |
| monto, moneda | Número y `ARS`/`USD` |
| medio | `efectivo`, `debito`, `visa`, `mastercard` |
| ambito | `personal` o `negocio` |
| fijo | `si` (gasto recurrente) o `no` (compra) |
| devuelto | `si`/`no`: si el negocio ya te devolvió un gasto que pagaste con tu tarjeta |
| fechaDevolucion | Fecha en que el negocio te lo devolvió |
| actualizado | Automático |

**Cuotas** (las compras en cuotas van acá, no en Gastos)
| Columna | Contenido |
|---|---|
| id | Identificador |
| descripcion | Texto |
| medio | `visa`, `mastercard`, `prestamo`, `otro` |
| montoCuota, moneda | Monto de cada cuota |
| cuotasTotales | Cantidad total de cuotas |
| mesPrimeraCuota | Mes de la primera cuota (`aaaa-mm`). En la app cargás "cuota actual" y este dato se calcula solo. Con eso la app sabe la cuota actual, el mes en que termina y desde cuándo se libera el monto. |
| ambito | `personal` o `negocio` |
| actualizado | Automático |

**Inversiones**
| Columna | Contenido |
|---|---|
| id | Identificador |
| activo | Símbolo: `BTC`, `ETH`, `USDT`, `USDC`, `PAXG`, `VOO`, `SPY`… Para dólares en efectivo, `USD`; para pesos, `ARS`. |
| tipo | `accion`, `cedear`, `etf`, `cripto`, `fci`, `on` (obligación negociable), `valuado` (otro activo con valor cargado a mano), `liquidez` (dinero disponible en cuentas o efectivo), `otro` |
| plataforma | `Cocos`, `Nexo`, `eToro`, `IOL`, `Bull Market`, `Efectivo USD`, `Otra` |
| cantidad | Cantidad de acciones o monedas. Para `fci`, `on`, `valuado` y `liquidez`: **saldo actual** |
| precioCompra | Precio promedio de compra por unidad. Para `fci`, `on` y `valuado`: **monto invertido total**; para `liquidez`: igual al saldo |
| monedaCompra | `USD` o `ARS` |
| tcCompra | Opcional: dólar del día de compra, para calcular mejor la ganancia en pesos |
| fechaCompra | Opcional |
| balde | Opcional: `emergencia`, `vivienda`, `vacaciones` o `inversion` (trading). Su valor de hoy se suma a ese objetivo |
| plan | Opcional: `vender` (la app la muestra como "Vender ya" si hoy da ganancia, o "Vender al recuperar" si da pérdida) o `esperar` |
| notaPlan | Opcional: qué hacer con la plata al vender (por ejemplo, "pasar a USDC") |
| actualizado | Automático |

**Vencimientos**
| Columna | Contenido |
|---|---|
| id, concepto, monto, moneda, fecha | Datos del pago |
| medio | `debito`, `efectivo`, `transferencia`, `visa`, `mastercard`, `otro` |
| estado | `pendiente` o `pagado` |
| origen | `manual`, `tarjeta` o `cuota` |
| ref | Solo para vencimientos automáticos, por ejemplo `tarjeta:visa:2026-10` |
| actualizado | Automático |

Los resúmenes de tarjeta y las cuotas que no se pagan con tarjeta los **calcula la app**. Solo se escriben en la hoja cuando los marcás como pagados.

**Objetivos** (una fila por balde, la crea la app cuando editás un balde)
| Columna | Contenido |
|---|---|
| id | Identificador |
| balde | `emergencia`, `vivienda`, `vacaciones`, `inversion` |
| nombre | Texto |
| meta, moneda | Meta del balde. Si el fondo de emergencia no tiene meta, se usa 6 meses de gasto promedio. |
| saldoInicial | Lo que ya tenías ahorrado. Se le suman los ingresos variables asignados al balde. y el valor de hoy de las inversiones asignadas. |

El balde `inversion` es **Trading (agresivo)**: en vez de meta tiene un tope (por defecto 10 % de lo invertido, configurable en Ajustes). El semáforo se pone amarillo o rojo si se pasa.
| fechaMeta | Opcional: fecha objetivo para calcular el aporte mensual sugerido |
| actualizado | Automático |

**Historial** (hoja extra, la llena la app sola)
| Columna | Contenido |
|---|---|
| id | `h-aaaa-mm-dd` (un registro por día) |
| fecha | Día |
| patrimonioARS, patrimonioUSD | Valor total de las inversiones ese día |
| dolar | Dólar usado para convertir |
| actualizado | Automático |

Se usa para la variación del patrimonio contra el mes anterior y para el gráfico de evolución.

**Cotizaciones** (acciones, ETF y CEDEAR con GOOGLEFINANCE)
| Columna | Contenido |
|---|---|
| simbolo | Símbolo tal como lo cargás en Inversiones, por ejemplo `VOO` |
| ticker | Ticker de Google Finance, por ejemplo `NYSEARCA:VOO` |
| precio | Fórmula `=IFERROR(GOOGLEFINANCE(B2))` (un solo argumento: funciona con coma o punto y coma). También podés escribir el precio a mano. |
| moneda | Moneda del precio (`USD` o `ARS`) |
| actualizado | Opcional. Si está vacío, la app muestra la hora en que se leyó el precio. |

Viene cargada con VOO, VT, SPY, SGOV, BIL, SCHD e IB01 (`LON:IB01`). Para agregar otro activo, sumá una fila con `simbolo`, `ticker` y `moneda`; el script completa las fórmulas solo. Para un CEDEAR cotizado en pesos, probá con un ticker de BCBA (por ejemplo `BCBA:SPY`) y moneda `ARS`. Si Google Finance no lo cubre, escribí el precio a mano en la columna `precio`.

---

## 2. Publicar el script

1. En la planilla, entrá a **Extensiones > Apps Script**.
2. Borrá el contenido de `Código.gs` y pegá todo el archivo `apps-script/Code.gs`. Guardá.
3. Elegí la función `prepararHojas` en la barra superior y tocá **Ejecutar**. Google te va a pedir permisos: aceptalos. Si aparece "Google no verificó esta app", tocá *Configuración avanzada > Ir a … (no seguro)*: el script es tuyo.
4. **Recomendado: poné una clave.** Entrá a **Configuración del proyecto** (ícono de engranaje) **> Propiedades de la secuencia de comandos > Agregar propiedad**, con nombre `TOKEN` y como valor una clave larga que inventes. Sin clave, cualquiera que tenga la URL puede leer y escribir tu hoja.
5. Entrá a **Implementar > Nueva implementación**. En el engranaje elegí **Aplicación web** y configurá:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona**
6. Tocá **Implementar** y copiá la **URL de la aplicación web**. Termina en `/exec`.
7. Si más adelante cambiás el código, entrá a **Implementar > Administrar implementaciones > editar (lápiz) > Versión: Nueva versión**. Así se mantiene la misma URL.

## 3. Alojar la app gratis

La app son archivos estáticos: `index.html`, `manifest.webmanifest`, `sw.js` e `icons/`. Para instalarla como PWA necesita HTTPS.

### Opción A: GitHub Pages
1. Subí la carpeta a un repositorio de GitHub (en este repo ya está en `finanzas/`).
2. En el repositorio, entrá a **Settings > Pages > Build and deployment**, elegí *Deploy from a branch*, la rama y la carpeta `/ (root)`, y guardá.
3. En uno o dos minutos la app queda en `https://TU-USUARIO.github.io/TU-REPO/finanzas/`.

### Opción B: Netlify
1. Entrá a [app.netlify.com/drop](https://app.netlify.com/drop).
2. Arrastrá la carpeta `finanzas` (la que tiene `index.html`).
3. Netlify te da una URL `https://algo.netlify.app`. Podés cambiarle el nombre en *Site settings*.

> Cada vez que publiques cambios en `index.html`, subí también la constante `VERSION` en `sw.js` (por ejemplo `finanzas-v2`) para que los celulares tomen la versión nueva.

## 4. Instalar en Android

1. Abrí la URL en **Chrome** en el celular.
2. Tocá el menú **⋮ > Instalar app** (o *Agregar a pantalla principal*).
3. Abrí la app desde el ícono, entrá a **Más > Ajustes** y completá:
   - **URL del script**: la del paso 2.6.
   - **Clave**: la misma del `TOKEN`, si la pusiste.
   - **Presupuesto mensual**, **disponible para tarjetas** y **días de cierre y vencimiento** de Visa y Mastercard.
4. Tocá **Probar conexión** y después **Guardar ajustes**. La app crea las hojas que falten y sincroniza.

---

## Cómo funciona

- **Sin conexión:** cada alta, edición o borrado se aplica en el celular y queda en una cola. El punto de color del encabezado muestra el estado: verde es sincronizado, amarillo es pendiente o sin conexión y rojo es error. Tocalo para sincronizar. Al volver la red, la cola se sube sola y se reintenta cada minuto.
- **Cotizaciones:**
  - Dólar oficial, blue, MEP y CCL de [dolarapi.com](https://dolarapi.com).
  - Cripto (BTC, ETH, USDT, USDC, PAXG) de CoinGecko.
  - Acciones y ETF de la hoja Cotizaciones.
  - Se actualizan cada 5 minutos y con el botón ⟳. Cada una muestra la hora de su última actualización. Si una fuente falla, se usa el último valor guardado con la marca **⚠ desactualizado**.
- **Moneda:** el botón `ARS`/`USD` del encabezado cambia la vista, y el selector de al lado elige qué dólar se usa para convertir (se toma el precio de venta). Los montos en dólares se convierten al dólar actual.
- **Semáforo:** siempre con ícono y palabra (✓ OK, ! Atención, ✕ Urgente). Los umbrales se cambian en Ajustes. Los valores por defecto son:
  - Ahorro: ≥ 20 % verde, 10–20 % amarillo.
  - Gasto contra presupuesto: ≤ 80 % verde, ≤ 100 % amarillo.
  - Ingreso fijo contra gasto fijo: > 110 % verde, ≥ 100 % amarillo.
  - Inversiones: pérdida < 5 % amarillo.
  - Concentración por plataforma: ≤ 30 % verde, ≤ 35 % amarillo.
  - Fondo de emergencia: < 3 meses rojo, 3–6 amarillo.
  - Bitcoin: banda de 3 a 7 % del patrimonio, con ±2 puntos en amarillo.
  - Deuda del negocio: rojo si pasan más de 30 días.
  - Cuotas a 30 días (agregado): ≤ 30 % del ingreso fijo verde, ≤ 50 % amarillo.
- **Alertas de pago:** verde si está pagado, amarillo si vence en 3 a 7 días, rojo si vence en menos de 3 días o ya venció. El Resumen muestra un banner rojo si algo venció o vence en 2 días, y otro si las tarjetas a pagar en los próximos 30 días superan lo que tenés disponible.
- **Definiciones:**
  - *Patrimonio* es el valor de mercado de todo lo cargado en Inversiones (incluí ahí tu efectivo como `USD` o `ARS`).
  - *Gasto personal* son los gastos de ámbito personal más las cuotas del período.
  - *Ahorro* es ingresos menos gasto personal.
  - Los gastos del negocio pagados con tarjeta personal no cuentan como gasto tuyo: se muestran como deuda del negocio hasta que los marcás como devueltos.
  - Cada cuota se imputa en la fecha de vencimiento del resumen de su tarjeta, o el día 10 si no es con tarjeta.

## Privacidad

La URL del script, la clave y los ajustes se guardan **solo en el dispositivo** (`localStorage`). Los archivos no traen datos personales. Desde **Ajustes** podés descargar una copia en JSON o borrar los datos locales; la hoja de Google no se toca.
