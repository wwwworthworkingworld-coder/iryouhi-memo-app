"""アプリのアイコンと起動画面を作る。py tools/make_icon.py"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent.parent
ASSETS = ROOT / "ios" / "App" / "App" / "Assets.xcassets"
NAVY_TOP, NAVY_BOTTOM = (36, 140, 118), (12, 70, 60)   # 緑系（経費メモの紺と区別する）
ORANGE, INK = (240, 130, 50), (31, 41, 51)


def gradient(size):
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        d.line([(0, y), (size, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(NAVY_TOP, NAVY_BOTTOM)))
    return img


def receipt(img, cx, cy, w, h):
    """下がぎざぎざのレシートに、線と金額を描く"""
    d = ImageDraw.Draw(img)
    x0, x1, y0, y1 = cx - w // 2, cx + w // 2, cy - h // 2, cy + h // 2
    n, tooth = 7, w / 7
    pts = [(x0, y0), (x1, y0), (x1, y1)]
    for i in range(n):
        pts += [(x1 - tooth * (i + 0.5), y1 - tooth * 0.55), (x1 - tooth * (i + 1), y1)]
    d.polygon(pts, fill=(255, 255, 255))
    for i, frac in enumerate((0.16, 0.28, 0.40)):
        yy = y0 + h * frac
        d.rounded_rectangle([x0 + w * 0.14, yy, x1 - w * (0.14 if i != 1 else 0.34), yy + h * 0.042], radius=h * 0.02, fill=(205, 214, 224))
    # 下部にオレンジの「＋」（医療のしるし。赤十字と見間違えない色と形にする）
    t, L = h * 0.045, h * 0.17
    cy2 = y0 + h * 0.66
    d.rounded_rectangle([cx - L, cy2 - t, cx + L, cy2 + t], radius=t, fill=ORANGE)
    d.rounded_rectangle([cx - t, cy2 - L, cx + t, cy2 + L], radius=t, fill=ORANGE)


S = 4
big = gradient(1024 * S)
receipt(big, 512 * S, 505 * S, 560 * S, 700 * S)
big.resize((1024, 1024), Image.LANCZOS).save(ASSETS / "AppIcon.appiconset" / "AppIcon-512@2x.png", optimize=True)

splash = Image.new("RGB", (2732, 2732), NAVY_BOTTOM)
receipt(splash, 1366, 1366, 280, 350)
for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
    splash.save(ASSETS / "Splash.imageset" / name, optimize=True)
print("ok")
