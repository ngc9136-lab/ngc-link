# Pieza del QR — NGC Tienda Aeronáutica

Genera las tres piezas del flyer QR (feed, historia, imprenta) a partir de un
único script, con los textos y el código de descuento como variables.

## Uso

```bash
pip install Pillow qrcode opencv-python-headless numpy
python3 generar_flyer_qr.py
```

Salida en `output/`:
- `ngc-qr-feed-1080x1080.png` — post cuadrado (Instagram/Facebook)
- `ngc-qr-historia-1080x1920.png` — historia vertical
- `ngc-qr-imprenta-A6-300dpi.png` — A6 lista para imprenta (300 dpi)
- `reporte_contraste_y_qr.txt` / `contraste.json` — verificación de contraste y lectura del QR

`informe_tarea1.html` es el informe visual (antes/después, contraste medido,
QR verificado). Se genera con `build_informe.py` a partir de
`informe_tarea1.template.html`.

## Pendiente

El logo real (ala cromada + escudo NGC) no se pudo descargar en este entorno —
el CDN de Tiendanube devuelve 403 por la política de red del sandbox. Las
piezas usan un wordmark tipográfico en lugar del logo oficial. Para
reemplazarlo: guardar el PNG del logo en `assets/brand/logo.png` y pegarlo en
`wing_glyph()` / donde corresponda dentro de `generar_flyer_qr.py`.

## Cambiar el código de descuento

Editar `DISCOUNT_CODE` al principio de `generar_flyer_qr.py` y volver a correr
el script. No usar códigos con O y 0 mezclados en el mismo texto.
