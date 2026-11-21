"""アプリのアイコンと起動画面を作る。py tools/make_icon.py
図柄：梅色の単色地に、白い家族 3 人のしるし（頭と肩）と琥珀色の小さな十字。紙・レシート・グラデーションは使わない（経費メモ・請求書と同じ型にしない）"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).parent.parent
ASSETS = ROOT / "ios" / "App" / "App" / "Assets.xcassets"
PLUM, WHITE, AMBER = (123, 45, 94), (255, 255, 255), (232, 170, 70)


def person(d, cx, base, r, shoulder_w, fill):
    """頭（円）と肩（上が丸い台形）"""
    d.ellipse([cx - r, base - r * 3.0, cx + r, base - r * 1.0], fill=fill)
    d.rounded_rectangle([cx - shoulder_w, base - r * 0.85, cx + shoulder_w, base + r * 1.6], radius=shoulder_w * 0.9, fill=fill)


def family(img, cx, cy, s):
    """s は基準の大きさ。大人 2 人の間に子ども 1 人"""
    d = ImageDraw.Draw(img)
    person(d, cx - s * 0.62, cy + s * 0.30, s * 0.26, s * 0.40, WHITE)
    person(d, cx + s * 0.62, cy + s * 0.30, s * 0.26, s * 0.40, WHITE)
    person(d, cx, cy + s * 0.55, s * 0.19, s * 0.29, WHITE)
    # 右上に小さな十字（医療のしるし。赤十字と見間違えない色）
    t, L = s * 0.055, s * 0.16
    qx, qy = cx + s * 0.95, cy - s * 0.78
    d.rounded_rectangle([qx - L, qy - t, qx + L, qy + t], radius=t, fill=AMBER)
    d.rounded_rectangle([qx - t, qy - L, qx + t, qy + L], radius=t, fill=AMBER)


S = 4
big = Image.new("RGB", (1024 * S, 1024 * S), PLUM)
family(big, 512 * S, 520 * S, 330 * S)
big.resize((1024, 1024), Image.LANCZOS).save(ASSETS / "AppIcon.appiconset" / "AppIcon-512@2x.png", optimize=True)

splash = Image.new("RGB", (2732, 2732), PLUM)
family(splash, 1366, 1366, 220)
for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
    splash.save(ASSETS / "Splash.imageset" / name, optimize=True)
print("ok")
