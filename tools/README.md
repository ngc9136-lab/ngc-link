# Herramientas NGC

Tres scripts que corren contra la tienda pública, **sin API de Tiendanube**
(el plan Estándar no tiene aplicaciones a medida).

```bash
cd tools
npm install                      # cheerio + image-size
npm i -D playwright sharp        # solo para verify-front y prep-photos
npx playwright install chromium
```

---

## 1. `audit-storefront.mjs` — auditor del storefront

```bash
node audit-storefront.mjs --store https://ngctienda.mitiendanube.com
```

Lee `/sitemap.xml`, entra a cada ficha, saca las imágenes de
`.product-detail-slider`, baja cada archivo y calcula **SHA-256**.
Agrupa por hash **dentro de cada producto**: sólo eso cuenta como repetida.

Salidas en `./salida/`:

- `informe.json` — todo lo medido, con una `huella` estable del contenido.
- `informe.html` — hoja de contacto: cada grupo de repetidas con las
  miniaturas reales, la que se queda en verde y las sobrantes en rojo.

Opciones: `--out`, `--cache`, `--concurrency`, `--limit N`, `--refresh`.

**Decisiones que conviene conocer**

| Decisión | Por qué |
|---|---|
| Hash de los bytes, no de la URL | La tienda pública repite la misma foto una vez por variante, con URL distinta cada vez. Contar por URL da falsos positivos. |
| Agrupa por producto, no global | Dos productos distintos pueden compartir legítimamente un archivo. |
| Lee `data-srcset` antes que `src` | Con lazy loading el `src` es un GIF de 1×1. |
| Del srcset toma el mayor `w`; si no hay descriptores, el último | En `atlantico` el orden es ascendente, así que coincide con "el último". |
| Una URL es ficha sólo si el HTML tiene `.product-detail-slider` u `og:type=product` | No se adivina por la forma de la URL. |
| Cachea páginas e imágenes en `.cache/` | Idempotente y barato de repetir. La segunda corrida no baja nada. |

**Criterio de aceptación del brief:** dos corridas seguidas dan la misma
`huella`, y el total tiene que dar **64 repetidas en 17 productos**. Si da otro
número, cambió la tienda o el método está mal: investigar antes de reportar.

---

## 2. `prep-photos.mjs` — preparar las fotos para volver a subir

```bash
node prep-photos.mjs --entrada ~/fotos-originales --salida fotos-listas
```

Estructura esperada de la entrada: **una carpeta por producto**.

Qué hace, en orden:

1. Deduplica por **SHA-256** antes de tocar nada → `duplicados.csv`.
2. Descarta las que no llegan a 1600 px de lado mayor → `volver-a-fotografiar.csv`.
   **No se agranda ningún archivo.**
3. Recorta el borde uniforme, encaja el producto en **1600×1600 con fondo
   blanco y 8% de margen**.
4. Renombra en kebab-case descriptivo (`gorra-faa-vista-trasera-02.jpg`).
5. Deja una carpeta por producto lista para arrastrar al panel.

Es idempotente: al volver a correrlo saltea lo ya exportado (`manifiesto.json`).

**Sobre el margen del 8%:** si después de recortar el aire el producto no llega
a los 1344 px de la caja de contenido, **no se agranda** — se exporta con más
margen y el archivo queda listado en `volver-a-fotografiar.csv` con
`exportada=si` y el motivo. Un archivo de 2400 px cuyo producto ocupa 900 px es,
en la práctica, una foto de 900 px.

Opciones: `--lado`, `--margen`, `--minimo`, `--calidad`, `--sin-recorte`,
`--umbral-recorte`, `--forzar`.

---

## 3. `verify-front.mjs` — verificador del front

```bash
node verify-front.mjs                      # sale 1 si algo falla
node verify-front.mjs --producto https://ngctienda.mitiendanube.com/parche-...
```

Siete chequeos:

1. existen `#ngc-fix` y `#ngc-fix-js`
2. los 4 banners de portada cargan (`naturalWidth > 0`)
3. `.item-link` sigue con `display:inline` y **sin** `-webkit-line-clamp`
4. `.btn-primary` da 4.5:1 o más contra su texto (resolviendo fondos transparentes)
5. ningún nombre de producto cortado en el listado, en escritorio
6. lo mismo en celular a 390 px, que es donde muerde el clamp
7. la ficha mide menos de 12.000 px

Si no corriste el auditor usa la ficha del brief; si corriste el auditor usa la
ficha con más fotos de `salida/informe.json`.

Opciones: `--store`, `--listado`, `--alto-maximo`, `--contraste-minimo`,
`--banners`, `--headed`.

---

## Pruebas

```bash
node test/audit.test.mjs    # auditor contra una tienda falsa con duplicados plantados
node test/verify.test.mjs   # verificador contra un front sano y uno roto
node test/prep.test.mjs     # pipeline de fotos con originales fabricados
```

Las fixtures (`fixtures/`) levantan un servidor local que imita la estructura de
Tiendanube. No tocan la tienda real.
