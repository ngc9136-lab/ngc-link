#!/usr/bin/env python3
"""Ensambla el informe HTML autocontenido (fuentes e imágenes en base64)."""
import base64

FONT_DIR = "/home/user/ngc-link/assets/fonts"
IMG_DIR = "/home/user/ngc-link/qr-flyer/output"


def b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


ORBITRON_BLACK = b64(f"{FONT_DIR}/Orbitron-Black.ttf")
ORBITRON_BOLD = b64(f"{FONT_DIR}/Orbitron-Bold.ttf")
CHAKRA_BOLD = b64(f"{FONT_DIR}/ChakraPetch-Bold.ttf")
CHAKRA_MED = b64(f"{FONT_DIR}/ChakraPetch-Medium.ttf")
CHAKRA_REG = b64(f"{FONT_DIR}/ChakraPetch-Regular.ttf")

IMG_FEED = b64(f"{IMG_DIR}/ngc-qr-feed-1080x1080.png")
IMG_STORY = b64(f"{IMG_DIR}/ngc-qr-historia-1080x1920.png")
IMG_PRINT = b64(f"{IMG_DIR}/ngc-qr-imprenta-A6-300dpi.png")

with open(f"{IMG_DIR}/contraste.json", "r", encoding="utf-8") as f:
    CONTRAST_JSON = f.read()

with open("/home/user/ngc-link/qr-flyer/informe_tarea1.template.html", "r", encoding="utf-8") as f:
    tpl = f.read()

out = (
    tpl.replace("__ORBITRON_BLACK__", ORBITRON_BLACK)
    .replace("__ORBITRON_BOLD__", ORBITRON_BOLD)
    .replace("__CHAKRA_BOLD__", CHAKRA_BOLD)
    .replace("__CHAKRA_MED__", CHAKRA_MED)
    .replace("__CHAKRA_REG__", CHAKRA_REG)
    .replace("__IMG_FEED__", IMG_FEED)
    .replace("__IMG_STORY__", IMG_STORY)
    .replace("__IMG_PRINT__", IMG_PRINT)
    .replace("__CONTRAST_JSON__", CONTRAST_JSON)
)

out_path = "/home/user/ngc-link/qr-flyer/informe_tarea1.html"
with open(out_path, "w", encoding="utf-8") as f:
    f.write(out)

print(f"Informe generado: {out_path} ({len(out)/1024:.0f} KB)")
