#!/usr/bin/env python3
"""
NGC Tienda Aeronáutica — generador de la pieza del QR.

Genera tres formatos (feed 1080x1080, historia 1080x1920, imprenta A6) a partir
de un único set de textos/colores definidos como configuración al principio del
archivo. No usa imágenes generadas por IA: todo se dibuja con Pillow (formas,
degradados, tipografía real) y el QR se genera con la librería `qrcode`.

Requisitos: pip install Pillow qrcode opencv-python-headless numpy
"""

import io
import math
import random

import cv2
import numpy as np
import qrcode
from qrcode.constants import ERROR_CORRECT_Q
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ============================================================================
# CONFIGURACIÓN — tocar solo acá para cambiar textos, código de descuento,
# colores o URL. El resto del script no debería necesitar cambios.
# ============================================================================

STORE_URL = "https://ngctienda.mitiendanube.com"

DISCOUNT_CODE = "NGC10"  # reemplaza a "BIENVENIDO10": corto, sin O/0 ambiguos, fácil de dictar
DISCOUNT_LINE = "Válido para tu primera compra"

BRAND_TITLE = "NGC TIENDA AERONÁUTICA"  # sin Λ: la letra es A
BRAND_SUBTITLE = "Parches e insignias de la Fuerza Aérea Argentina"
CTA_SCAN = "ESCANEÁ Y COMPRÁ"
FOOTER_URL = "ngctienda.mitiendanube.com"
FOOTER_PLATFORM = "Tienda oficial en Tiendanube"  # crédito discreto, no protagonista

# Paleta oficial NGC
C_BG_TOP = (5, 8, 16)          # negro espacio, zona superior del starfield
C_BG_BOTTOM = (0, 0, 0)        # negro espacio puro
C_NEBULA_A = (18, 39, 90)      # azul nebulosa oscuro  #12275A
C_NEBULA_B = (46, 95, 184)     # azul nebulosa claro   #2E5FB8
C_CHROME_A = (200, 205, 212)   # plata cromo           #C8CDD4
C_CHROME_B = (242, 244, 247)   # plata cromo claro     #F2F4F7
C_GOLD = (232, 200, 122)       # oro NGC               #E8C87A
C_GOLD_LIGHT = (240, 210, 142) # oro claro              #F0D28E
C_TEXT_MAIN = (232, 238, 245)  # texto principal        #E8EEF5
C_TEXT_MUTED = (185, 199, 212) # texto secundario       #B9C7D4
C_TEXT_ON_GOLD = (16, 32, 46)  # texto sobre oro, siempre oscuro #10202E
C_WHITE = (255, 255, 255)

FONT_DIR = "/home/user/ngc-link/assets/fonts"
F_ORBITRON_BLACK = f"{FONT_DIR}/Orbitron-Black.ttf"
F_ORBITRON_XBOLD = f"{FONT_DIR}/Orbitron-ExtraBold.ttf"
F_ORBITRON_BOLD = f"{FONT_DIR}/Orbitron-Bold.ttf"
F_CHAKRA_BOLD = f"{FONT_DIR}/ChakraPetch-Bold.ttf"
F_CHAKRA_SEMI = f"{FONT_DIR}/ChakraPetch-SemiBold.ttf"
F_CHAKRA_MED = f"{FONT_DIR}/ChakraPetch-Medium.ttf"
F_CHAKRA_REG = f"{FONT_DIR}/ChakraPetch-Regular.ttf"

OUT_DIR = "/home/user/ngc-link/qr-flyer/output"

RNG_SEED = 42  # fija la posición de las estrellas para que el resultado sea reproducible

# ============================================================================
# UTILIDADES DE BAJO NIVEL
# ============================================================================


def font(path, size):
    return ImageFont.truetype(path, size)


def relative_luminance(rgb):
    def chan(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = rgb
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)


def contrast_ratio(rgb1, rgb2):
    l1 = relative_luminance(rgb1)
    l2 = relative_luminance(rgb2)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def avg_color_under_box(img, box):
    """Color medio real del fondo ya compuesto (starfield + nebulosa + scrims),
    tal cual quedaría debajo del texto, muestreado del propio canvas RGB."""
    crop = img.convert("RGB").crop(box)
    arr = np.asarray(crop).reshape(-1, 3)
    return tuple(int(v) for v in arr.mean(axis=0))


def make_starfield(w, h, n_stars, seed=RNG_SEED):
    rnd = random.Random(seed)
    img = Image.new("RGB", (w, h), C_BG_BOTTOM)
    # gradiente vertical negro espacio -> negro puro
    top = np.array(C_BG_TOP, dtype=np.float32)
    bot = np.array(C_BG_BOTTOM, dtype=np.float32)
    grad = np.linspace(0, 1, h).reshape(h, 1, 1)
    row = top * (1 - grad) + bot * grad
    arr = np.repeat(row, w, axis=1).astype(np.uint8)
    img = Image.fromarray(arr, "RGB")

    star_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(star_layer)
    for _ in range(n_stars):
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        r = rnd.uniform(0.4, 1.6)
        alpha = int(rnd.uniform(90, 230))
        tint = rnd.choice([(255, 255, 255), (210, 225, 255), (255, 244, 214)])
        sd.ellipse([x - r, y - r, x + r, y + r], fill=(*tint, alpha))
    star_layer = star_layer.filter(ImageFilter.GaussianBlur(0.3))
    img.paste(Image.alpha_composite(img.convert("RGBA"), star_layer).convert("RGB"), (0, 0))
    return img


def add_nebula(img, cx, cy, rx, ry, strength=0.55):
    """Nebulosa azul tipo blob radial, mezclada en modo screen para que
    ilumine el starfield sin taparlo."""
    w, h = img.size
    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
    mask = np.clip(1 - dist, 0, 1) ** 1.6
    mask *= strength

    base = np.asarray(img).astype(np.float32)
    a = np.array(C_NEBULA_A, dtype=np.float32)
    b = np.array(C_NEBULA_B, dtype=np.float32)
    t = np.clip((cy - yy) / (ry * 1.4) + 0.5, 0, 1)[..., None]
    nebula_color = a * (1 - t) + b * t

    screen = 255 - (255 - base) * (255 - nebula_color) / 255
    out = base * (1 - mask[..., None]) + screen * mask[..., None]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def add_scrim(img, box, opacity=0.35, feather=40):
    """Oscurece una franja rectangular (con bordes difusos) para garantizar
    contraste de texto sobre zonas claras del starfield/nebulosa."""
    w, h = img.size
    x0, y0, x1, y1 = box
    scrim = Image.new("L", (w, h), 0)
    sd = ImageDraw.Draw(scrim)
    sd.rectangle([x0, y0, x1, y1], fill=int(255 * opacity))
    scrim = scrim.filter(ImageFilter.GaussianBlur(feather))
    black = Image.new("RGB", (w, h), (0, 0, 0))
    return Image.composite(black, img, scrim)


def draw_text(draw, xy, text, fnt, fill, anchor="la", tracking=0):
    """Dibuja texto con tracking (espaciado entre letras) manual, porque
    Pillow no soporta letter-spacing nativo."""
    if tracking == 0:
        draw.text(xy, text, font=fnt, fill=fill, anchor=anchor)
        return draw.textbbox(xy, text, font=fnt, anchor=anchor)

    widths = [draw.textlength(ch, font=fnt) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x, y = xy
    if anchor[0] == "m":
        x -= total / 2
    elif anchor[0] == "r":
        x -= total
    cur_x = x
    for ch, wch in zip(text, widths):
        draw.text((cur_x, y), ch, font=fnt, fill=fill, anchor="l" + anchor[1])
        cur_x += wch + tracking
    return (x, y, x + total, y + fnt.size)


def chrome_gradient_text(base_img, xy, text, fnt, anchor="la", tracking=0):
    """Renderiza texto con degradado plata cromo (usado para el wordmark),
    componiendo sobre base_img con máscara alpha del texto."""
    dummy = ImageDraw.Draw(base_img)
    bbox = draw_text(ImageDraw.Draw(Image.new("RGB", (10, 10))), (0, 0), text, fnt, C_WHITE, anchor="la", tracking=tracking)
    tw, th = bbox[2] - bbox[0], fnt.size

    mask = Image.new("L", (int(tw) + 4, int(th * 1.6) + 4), 0)
    md = ImageDraw.Draw(mask)
    draw_text(md, (2, 2), text, fnt, 255, anchor="la", tracking=tracking)

    grad = Image.new("RGB", mask.size, C_CHROME_A)
    garr = np.linspace(0, 1, mask.size[1]).reshape(-1, 1, 1)
    a = np.array(C_CHROME_A, dtype=np.float32)
    b = np.array(C_CHROME_B, dtype=np.float32)
    row = a * (1 - garr) + b * garr
    grad_arr = np.repeat(row, mask.size[0], axis=1).astype(np.uint8)
    grad = Image.fromarray(grad_arr, "RGB")

    x, y = xy
    if anchor[0] == "m":
        x -= tw / 2
    elif anchor[0] == "r":
        x -= tw
    if anchor[1] == "m":
        y -= th / 2
    paste_xy = (int(x) - 2, int(y) - 2)
    base_img.paste(grad, paste_xy, mask)
    return (paste_xy[0], paste_xy[1], paste_xy[0] + mask.size[0], paste_xy[1] + mask.size[1])


def rounded_rect(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def wing_glyph(size, color):
    """Motivo geométrico decorativo tipo 'ala' (chevrones), NO es el logo
    oficial de NGC — el PNG del ala cromada + escudo no pudo descargarse en
    este entorno (CDN de Tiendanube bloqueado por la política de red del
    sandbox, ver nota en el informe). Placeholder a reemplazar."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = size / 2, size / 2
    for i, sweep in enumerate([1, -1]):
        pts = []
        span = size * 0.46
        for t in np.linspace(0, 1, 24):
            x = cx + sweep * t * span
            y = cy - (size * 0.30) * (1 - (1 - t) ** 1.6) + size * 0.02
            pts.append((x, y))
        pts += [(cx + sweep * span, cy + size * 0.06), (cx, cy + size * 0.02)]
        d.polygon(pts, fill=(*color, 235))
    d.ellipse([cx - size * 0.05, cy - size * 0.05, cx + size * 0.05, cy + size * 0.05], fill=(*C_GOLD, 255))
    return img


def make_qr_image(url, box_px, border_modules=4):
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_Q,
        box_size=10,
        border=border_modules,  # zona de silencio >= 4 módulos
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color=(16, 32, 46), back_color=(255, 255, 255)).convert("RGB")
    img = img.resize((box_px, box_px), Image.NEAREST)
    return img, qr.modules_count + border_modules * 2


# ============================================================================
# REGISTRO DE CONTRASTE — se completa a medida que se dibuja cada pieza
# ============================================================================

CONTRAST_LOG = []


def log_contrast(piece, label, text_rgb, bg_img, box):
    bg = avg_color_under_box(bg_img, box)
    ratio = contrast_ratio(text_rgb, bg)
    CONTRAST_LOG.append(
        {
            "piece": piece,
            "label": label,
            "text_rgb": text_rgb,
            "bg_rgb_sampled": bg,
            "ratio": ratio,
            "ok": ratio >= 4.5,
        }
    )
    return ratio


# ============================================================================
# PIEZA 1 — FEED 1080x1080 (cuadrado)
# ============================================================================


def build_feed():
    W = H = 1080
    piece = "feed_1080x1080"
    img = make_starfield(W, H, n_stars=260)
    img = add_nebula(img, cx=W * 0.5, cy=H * 0.16, rx=W * 0.85, ry=H * 0.55, strength=0.6)
    img = add_scrim(img, (0, 0, W, 240), opacity=0.30, feather=60)
    img = add_scrim(img, (0, 700, W, H), opacity=0.45, feather=50)
    img = img.convert("RGBA")
    draw = ImageDraw.Draw(img)

    margin = 44
    y = margin

    # eyebrow
    f_eyebrow = font(F_CHAKRA_SEMI, 20)
    draw_text(draw, (W / 2, y), "TIENDA AERONÁUTICA · MALVINAS · FAA", f_eyebrow, C_GOLD, anchor="ma", tracking=2)
    log_contrast(piece, "eyebrow", C_GOLD, img, (40, y - 4, W - 40, y + 30))
    y += 46

    # glyph decorativo
    glyph_size = 74
    glyph = wing_glyph(glyph_size, C_CHROME_A)
    img.paste(glyph, (int(W / 2 - glyph_size / 2), y), glyph)
    y += glyph_size + 8

    # wordmark cromado
    f_brand = font(F_ORBITRON_BLACK, 54)
    chrome_gradient_text(img, (W / 2, y), "NGC", f_brand, anchor="ma", tracking=5)
    y += 66
    f_brand2 = font(F_ORBITRON_XBOLD, 27)
    chrome_gradient_text(img, (W / 2, y), "TIENDA AERONÁUTICA", f_brand2, anchor="ma", tracking=2)
    y += 42

    # subtítulo — qué vende
    f_sub = font(F_CHAKRA_MED, 23)
    draw_text(draw, (W / 2, y), BRAND_SUBTITLE, f_sub, C_TEXT_MAIN, anchor="ma")
    log_contrast(piece, "subtitulo", C_TEXT_MAIN, img, (110, y - 4, W - 110, y + 30))
    y += 40

    # CTA
    f_cta = font(F_ORBITRON_BOLD, 25)
    draw_text(draw, (W / 2, y), CTA_SCAN, f_cta, C_GOLD_LIGHT, anchor="ma", tracking=3)
    log_contrast(piece, "cta_escanea", C_GOLD_LIGHT, img, (260, y - 4, W - 260, y + 34))
    y += 44

    # panel QR con zona de silencio
    qr_px = 340
    qr_img, modules = make_qr_image(STORE_URL, qr_px)
    pad = 36  # margen blanco alrededor del QR (> 4 módulos, ver informe)
    panel_w = qr_px + pad * 2
    panel_h = qr_px + pad * 2
    panel_x = (W - panel_w) / 2
    panel_y = y
    rounded_rect(draw, [panel_x, panel_y, panel_x + panel_w, panel_y + panel_h], radius=26, fill=C_WHITE)
    img.paste(qr_img, (int(panel_x + pad), int(panel_y + pad)))
    y = panel_y + panel_h + 28

    # código de descuento (chip dorado)
    f_code = font(F_ORBITRON_BLACK, 34)
    code_w = draw.textlength(DISCOUNT_CODE, font=f_code) + 76
    chip_h = 62
    chip_box = [W / 2 - code_w / 2, y, W / 2 + code_w / 2, y + chip_h]
    rounded_rect(draw, chip_box, radius=18, fill=C_GOLD)
    draw_text(draw, (W / 2, y + chip_h / 2), DISCOUNT_CODE, f_code, C_TEXT_ON_GOLD, anchor="mm", tracking=3)
    log_contrast(piece, "codigo_descuento", C_TEXT_ON_GOLD, img.convert("RGB"), tuple(map(int, chip_box)))
    y += chip_h + 24

    # línea de validez
    f_valid = font(F_CHAKRA_MED, 20)
    draw_text(draw, (W / 2, y), DISCOUNT_LINE, f_valid, C_TEXT_MAIN, anchor="ma")
    log_contrast(piece, "linea_validez", C_TEXT_MAIN, img.convert("RGB"), (170, y - 4, W - 170, y + 26))
    y += 40

    # footer discreto: url + crédito de plataforma
    assert y + 66 <= H - margin, f"el contenido ({y + 66}px) no entra en el lienzo ({H}px)"
    f_url = font(F_CHAKRA_SEMI, 21)
    draw_text(draw, (W / 2, y), FOOTER_URL, f_url, C_TEXT_MUTED, anchor="ma")
    log_contrast(piece, "footer_url", C_TEXT_MUTED, img.convert("RGB"), (260, y - 4, W - 260, y + 28))
    y += 30
    f_plat = font(F_CHAKRA_REG, 15)
    draw_text(draw, (W / 2, y), FOOTER_PLATFORM, f_plat, (150, 165, 182), anchor="ma")

    return img.convert("RGB")


# ============================================================================
# PIEZA 2 — HISTORIA 1080x1920 (vertical)
# ============================================================================


def build_story():
    W, H = 1080, 1920
    piece = "story_1080x1920"
    img = make_starfield(W, H, n_stars=420)
    img = add_nebula(img, cx=W * 0.5, cy=H * 0.20, rx=W * 0.95, ry=H * 0.30, strength=0.62)
    img = add_scrim(img, (0, 0, W, 420), opacity=0.28, feather=70)
    img = add_scrim(img, (0, 1180, W, H), opacity=0.48, feather=60)
    img = img.convert("RGBA")
    draw = ImageDraw.Draw(img)

    # zona segura de historias: se evita contenido clave en 0-200 y 1720-1920
    top_safe = 220

    f_eyebrow = font(F_CHAKRA_SEMI, 26)
    draw_text(draw, (W / 2, top_safe), "TIENDA AERONÁUTICA · MALVINAS · FAA", f_eyebrow, C_GOLD, anchor="ma", tracking=3)
    log_contrast(piece, "eyebrow", C_GOLD, img, (40, top_safe - 6, W - 40, top_safe + 34))

    glyph = wing_glyph(130, C_CHROME_A)
    img.paste(glyph, (int(W / 2 - 65), top_safe + 60), glyph)

    f_brand = font(F_ORBITRON_BLACK, 92)
    chrome_gradient_text(img, (W / 2, top_safe + 220), "NGC", f_brand, anchor="ma", tracking=8)
    f_brand2 = font(F_ORBITRON_XBOLD, 42)
    chrome_gradient_text(img, (W / 2, top_safe + 340), "TIENDA AERONÁUTICA", f_brand2, anchor="ma", tracking=3)

    f_sub = font(F_CHAKRA_MED, 33)
    draw_text(draw, (W / 2, top_safe + 424), BRAND_SUBTITLE, f_sub, C_TEXT_MAIN, anchor="ma")
    log_contrast(piece, "subtitulo", C_TEXT_MAIN, img, (100, top_safe + 416, W - 100, top_safe + 460))

    f_cta = font(F_ORBITRON_BOLD, 38)
    draw_text(draw, (W / 2, top_safe + 508), CTA_SCAN, f_cta, C_GOLD_LIGHT, anchor="ma", tracking=5)
    log_contrast(piece, "cta_escanea", C_GOLD_LIGHT, img, (280, top_safe + 500, W - 280, top_safe + 548))

    qr_px = 560
    qr_img, modules = make_qr_image(STORE_URL, qr_px)
    pad = 56
    panel_w = qr_px + pad * 2
    panel_h = qr_px + pad * 2
    panel_x = (W - panel_w) / 2
    panel_y = top_safe + 580
    rounded_rect(draw, [panel_x, panel_y, panel_x + panel_w, panel_y + panel_h], radius=34, fill=C_WHITE)
    img.paste(qr_img, (int(panel_x + pad), int(panel_y + pad)))

    chip_y = panel_y + panel_h + 46
    f_code = font(F_ORBITRON_BLACK, 52)
    code_w = draw.textlength(DISCOUNT_CODE, font=f_code) + 110
    chip_box = [W / 2 - code_w / 2, chip_y, W / 2 + code_w / 2, chip_y + 92]
    rounded_rect(draw, chip_box, radius=24, fill=C_GOLD)
    draw_text(draw, (W / 2, chip_y + 46), DISCOUNT_CODE, f_code, C_TEXT_ON_GOLD, anchor="mm", tracking=5)
    log_contrast(piece, "codigo_descuento", C_TEXT_ON_GOLD, img.convert("RGB"), tuple(map(int, chip_box)))

    f_valid = font(F_CHAKRA_MED, 29)
    draw_text(draw, (W / 2, chip_y + 122), DISCOUNT_LINE, f_valid, C_TEXT_MAIN, anchor="ma")
    log_contrast(piece, "linea_validez", C_TEXT_MAIN, img.convert("RGB"), (180, chip_y + 114, W - 180, chip_y + 154))

    bottom_safe = H - 200
    f_url = font(F_CHAKRA_SEMI, 28)
    draw_text(draw, (W / 2, bottom_safe - 10), FOOTER_URL, f_url, C_TEXT_MUTED, anchor="ma")
    log_contrast(piece, "footer_url", C_TEXT_MUTED, img.convert("RGB"), (260, bottom_safe - 16, W - 260, bottom_safe + 20))
    f_plat = font(F_CHAKRA_REG, 20)
    draw_text(draw, (W / 2, bottom_safe + 30), FOOTER_PLATFORM, f_plat, (150, 165, 182), anchor="ma")

    return img.convert("RGB")


# ============================================================================
# PIEZA 3 — IMPRENTA A6 (105 x 148 mm a 300 dpi = 1240 x 1748 px)
# ============================================================================


def build_print_a6():
    DPI = 300
    W = round(105 / 25.4 * DPI)  # 1240
    H = round(148 / 25.4 * DPI)  # 1748
    piece = "print_A6"
    margin = round(6 / 25.4 * DPI)  # 6 mm de margen de seguridad

    img = make_starfield(W, H, n_stars=520)
    img = add_nebula(img, cx=W * 0.5, cy=H * 0.14, rx=W * 0.9, ry=H * 0.26, strength=0.55)
    img = add_scrim(img, (0, 0, W, margin + 360), opacity=0.30, feather=70)
    img = add_scrim(img, (0, H - margin - 420, W, H), opacity=0.50, feather=60)
    img = img.convert("RGBA")
    draw = ImageDraw.Draw(img)

    y = margin + 30
    f_eyebrow = font(F_CHAKRA_SEMI, 24)
    draw_text(draw, (W / 2, y), "TIENDA AERONÁUTICA · MALVINAS · FAA", f_eyebrow, C_GOLD, anchor="ma", tracking=2)
    log_contrast(piece, "eyebrow", C_GOLD, img, (margin, y - 6, W - margin, y + 32))
    y += 60

    glyph = wing_glyph(100, C_CHROME_A)
    img.paste(glyph, (int(W / 2 - 50), y), glyph)
    y += 116

    f_brand = font(F_ORBITRON_BLACK, 78)
    chrome_gradient_text(img, (W / 2, y), "NGC", f_brand, anchor="ma", tracking=6)
    y += 100
    f_brand2 = font(F_ORBITRON_XBOLD, 34)
    chrome_gradient_text(img, (W / 2, y), "TIENDA AERONÁUTICA", f_brand2, anchor="ma", tracking=2)
    y += 66

    f_sub = font(F_CHAKRA_MED, 27)
    draw_text(draw, (W / 2, y), BRAND_SUBTITLE, f_sub, C_TEXT_MAIN, anchor="ma")
    log_contrast(piece, "subtitulo", C_TEXT_MAIN, img, (margin + 40, y - 6, W - margin - 40, y + 34))
    y += 66

    f_cta = font(F_ORBITRON_BOLD, 32)
    draw_text(draw, (W / 2, y), CTA_SCAN, f_cta, C_GOLD_LIGHT, anchor="ma", tracking=4)
    log_contrast(piece, "cta_escanea", C_GOLD_LIGHT, img, (margin + 60, y - 6, W - margin - 60, y + 38))
    y += 66

    qr_px = 560  # ~47mm impreso: cómodo para escanear a distancia de brazo
    qr_img, modules = make_qr_image(STORE_URL, qr_px)
    pad = 55
    panel_w = qr_px + pad * 2
    panel_h = qr_px + pad * 2
    panel_x = (W - panel_w) / 2
    panel_y = y
    rounded_rect(draw, [panel_x, panel_y, panel_x + panel_w, panel_y + panel_h], radius=30, fill=C_WHITE)
    img.paste(qr_img, (int(panel_x + pad), int(panel_y + pad)))
    y = panel_y + panel_h + 42

    f_code = font(F_ORBITRON_BLACK, 44)
    code_w = draw.textlength(DISCOUNT_CODE, font=f_code) + 96
    chip_box = [W / 2 - code_w / 2, y, W / 2 + code_w / 2, y + 78]
    rounded_rect(draw, chip_box, radius=20, fill=C_GOLD)
    draw_text(draw, (W / 2, y + 39), DISCOUNT_CODE, f_code, C_TEXT_ON_GOLD, anchor="mm", tracking=4)
    log_contrast(piece, "codigo_descuento", C_TEXT_ON_GOLD, img.convert("RGB"), tuple(map(int, chip_box)))
    y += 78 + 40

    f_valid = font(F_CHAKRA_MED, 25)
    draw_text(draw, (W / 2, y), DISCOUNT_LINE, f_valid, C_TEXT_MAIN, anchor="ma")
    log_contrast(piece, "linea_validez", C_TEXT_MAIN, img.convert("RGB"), (margin + 60, y - 6, W - margin - 60, y + 30))
    y += 68

    assert y + 60 <= H - margin, f"el contenido ({y + 60}px) no entra en el lienzo ({H}px)"
    f_url = font(F_CHAKRA_SEMI, 25)
    draw_text(draw, (W / 2, y), FOOTER_URL, f_url, C_TEXT_MUTED, anchor="ma")
    log_contrast(piece, "footer_url", C_TEXT_MUTED, img.convert("RGB"), (margin + 60, y - 6, W - margin - 60, y + 28))
    y += 36
    f_plat = font(F_CHAKRA_REG, 18)
    draw_text(draw, (W / 2, y), FOOTER_PLATFORM, f_plat, (150, 165, 182), anchor="ma")

    final = img.convert("RGB")
    final.info["dpi"] = (DPI, DPI)
    return final, DPI


# ============================================================================
# VERIFICACIÓN DEL QR — decodifica el PNG final con OpenCV y confirma que
# la URL leída es exactamente la que se codificó.
# ============================================================================


def verify_qr_readable(pil_img, expected_url):
    arr = cv2.cvtColor(np.array(pil_img.convert("RGB")), cv2.COLOR_RGB2BGR)
    detector = cv2.QRCodeDetector()
    data, points, _ = detector.detectAndDecode(arr)
    ok = (data == expected_url)
    return ok, data


# ============================================================================
# MAIN
# ============================================================================


def main():
    import os

    os.makedirs(OUT_DIR, exist_ok=True)

    pieces = []

    feed = build_feed()
    feed_path = f"{OUT_DIR}/ngc-qr-feed-1080x1080.png"
    feed.save(feed_path, "PNG")
    pieces.append(("Feed 1080x1080", feed_path, feed))

    story = build_story()
    story_path = f"{OUT_DIR}/ngc-qr-historia-1080x1920.png"
    story.save(story_path, "PNG")
    pieces.append(("Historia 1080x1920", story_path, story))

    print_img, dpi = build_print_a6()
    print_path = f"{OUT_DIR}/ngc-qr-imprenta-A6-300dpi.png"
    print_img.save(print_path, "PNG", dpi=(dpi, dpi))
    pieces.append((f"Imprenta A6 @{dpi}dpi", print_path, print_img))

    # --- Verificación de lectura del QR sobre cada pieza final ---
    print("\n=== VERIFICACIÓN DE LECTURA DEL QR (OpenCV QRCodeDetector) ===")
    all_qr_ok = True
    for name, path, img in pieces:
        ok, data = verify_qr_readable(img, STORE_URL)
        all_qr_ok = all_qr_ok and ok
        status = "OK" if ok else "FALLA"
        print(f"[{status}] {name}: decodificado = {data!r}")

    # --- Reporte de contraste ---
    print("\n=== CONTRASTE DE TEXTO (WCAG, mínimo exigido 4.5:1) ===")
    all_contrast_ok = True
    for row in CONTRAST_LOG:
        all_contrast_ok = all_contrast_ok and row["ok"]
        status = "OK" if row["ok"] else "FALLA"
        print(
            f"[{status}] {row['piece']:22s} {row['label']:18s} "
            f"texto={row['text_rgb']} fondo≈{row['bg_rgb_sampled']} ratio={row['ratio']:.2f}:1"
        )

    print("\n=== RESUMEN ===")
    print(f"QR legible en las 3 piezas: {'SI' if all_qr_ok else 'NO -- revisar'}")
    print(f"Contraste >=4.5:1 en todos los textos: {'SI' if all_contrast_ok else 'NO -- revisar'}")
    for name, path, _ in pieces:
        print(f"  - {name}: {path}")

    # Guarda el reporte también en un .txt para adjuntar
    report_path = f"{OUT_DIR}/reporte_contraste_y_qr.txt"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("NGC Tienda Aeronáutica -- Pieza del QR -- Reporte de verificación\n")
        f.write("=" * 70 + "\n\n")
        f.write("LECTURA DEL QR (OpenCV QRCodeDetector)\n")
        for name, path, img in pieces:
            ok, data = verify_qr_readable(img, STORE_URL)
            f.write(f"  [{'OK' if ok else 'FALLA'}] {name}: {data!r}\n")
        f.write("\nCONTRASTE DE TEXTO (WCAG 2.1, minimo 4.5:1)\n")
        for row in CONTRAST_LOG:
            f.write(
                f"  [{'OK' if row['ok'] else 'FALLA'}] {row['piece']:22s} {row['label']:18s} "
                f"texto={row['text_rgb']} fondo~{row['bg_rgb_sampled']} ratio={row['ratio']:.2f}:1\n"
            )
        f.write(f"\nQR legible en las 3 piezas: {'SI' if all_qr_ok else 'NO'}\n")
        f.write(f"Contraste OK en todos los textos: {'SI' if all_contrast_ok else 'NO'}\n")

    print(f"\nReporte guardado en: {report_path}")

    # JSON del log de contraste, para que el informe HTML lo consuma sin re-inventar números
    import json

    piece_labels = {
        "feed_1080x1080": "Feed 1080×1080",
        "story_1080x1920": "Historia 1080×1920",
        "print_A6": "Imprenta A6",
    }
    label_labels = {
        "eyebrow": "Eyebrow superior",
        "subtitulo": "Subtítulo (qué vende)",
        "cta_escanea": "CTA “Escaneá y comprá”",
        "codigo_descuento": "Código de descuento",
        "linea_validez": "Línea de validez",
        "footer_url": "URL del pie",
    }
    json_rows = [
        {
            "piece": piece_labels.get(r["piece"], r["piece"]),
            "label": label_labels.get(r["label"], r["label"]),
            "bg": list(r["bg_rgb_sampled"]),
            "ratio": round(r["ratio"], 2),
        }
        for r in CONTRAST_LOG
    ]
    json_path = f"{OUT_DIR}/contraste.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(json_rows, f, ensure_ascii=False, indent=2)
    print(f"JSON de contraste guardado en: {json_path}")

    return all_qr_ok and all_contrast_ok


if __name__ == "__main__":
    ok = main()
    raise SystemExit(0 if ok else 1)
