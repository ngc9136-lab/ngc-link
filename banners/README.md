# Banners de portada

`banner-1.html` es el primer banner de escritorio, el que faltaba
(`ngc-banner-2/3/4` ya estaban hechos).

El arte original era un collage fotográfico **vertical** — un F-16, un piloto,
un modelo con campera bomber, parches y una mochila. Recortarlo a horizontal lo
arruina, así que esto es una composición nueva a 1920×800, tipográfica, con el
mismo sistema visual: degradé navy `#0B1327` → `#133C5C` (50%) → `#071021`,
dorado `#D8B868`, Poppins, regla dorada de 4 px arriba y reglas laterales finas.

No lleva fotos: no tengo los originales del collage y no vale la pena inventar
una imagen que no existe. Si aparecen las fotos, el hueco natural es el lateral
derecho del bloque central.

## Construir

```bash
cd banners
node build-banner.mjs           # banner-1.{png,jpg} 1920×800 + @2x
node build-banner.mjs --solo-1x
```

`build-banner.mjs` embebe Poppins en base64 dentro del HTML (viene de
`@fontsource/poppins` por npm, **no de Google Fonts**), así que
`banner-1.embebido.html` no depende de la red. Antes de sacar el PNG comprueba
con `document.fonts.check()` que Poppins cargó de verdad: si no, aborta en vez
de renderizar con la fuente de respaldo sin avisar.

Depende de `playwright` y `@fontsource/poppins`, que están instalados en
`../tools/node_modules`.

## Contraste medido

| Par | Ratio |
|---|---|
| titular blanco `#ffffff` sobre `#133C5C` | 11.48:1 |
| dorado `#D8B868` sobre `#0B1327` | 9.66:1 |
| bajada `#C6D0DC` sobre `#133C5C` | 7.36:1 |
| CTA: `#0B1327` sobre `#D8B868` | 9.66:1 |

## Qué subir al panel

`banner-1.jpg` (107 KB) para el slot de escritorio. `banner-1@2x.jpg` (236 KB)
si el tema sirve retina. Los `.png` son la versión sin pérdida por si hay que
retocar; `banner-1@2x.png` no se versiona (3 MB) — se regenera con el script.
