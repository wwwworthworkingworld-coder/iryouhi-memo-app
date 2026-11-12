"""App Store の画像（1320×2868）を作る。画面は架空のデータ。
py tools/make_store_images.py <出力先> [撮影済みの画面のフォルダー]
撮影済みのフォルダーがなければ、Chromeで www を開いて撮る（tools/serve_test.py を別に起動しておく）。"""
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1320, 2868
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BOLD = r"C:\Windows\Fonts\meiryob.ttc"
TOP, BOTTOM = (36, 140, 118), (12, 70, 60)
SHOTS = [
    ("1_home", "?seed=1&shot=1#home", ["家族の医療費が", "ひと目でわかる"], "今年の合計と、控除の目安"),
    ("2_scan", "?seed=1&shot=1&scan=1#add", ["レシートを撮るだけ", "日付と金額を読み取り"], "写真は送信しません。iPhoneの中で読み取ります"),
    ("3_list", "?seed=1&shot=1#list", ["家族別・病院別に", "1年ためる"], "タップで修正・削除。通院の交通費も"),
    ("4_more", "?seed=1&shot=1#more", ["国税庁の集計フォームに", "そのまま書き出し"], "作成コーナーで読み込めば打ち直し不要"),
]


def capture(name, query, folder):
    prof = tempfile.mkdtemp(prefix="chrome_")
    out = folder / f"{name}.png"
    subprocess.run([CHROME, "--headless=new", "--no-sandbox", f"--user-data-dir={prof}", "--hide-scrollbars", "--disable-gpu", "--no-first-run",
                    "--window-size=500,956", "--force-device-scale-factor=3", "--virtual-time-budget=4000",
                    f"--screenshot={out}", f"http://localhost:8767/frame?q={urllib.parse.quote(query)}"], check=False, capture_output=True, timeout=120)
    shutil.rmtree(prof, ignore_errors=True)
    Image.open(out).crop((0, 0, W, H)).save(out)
    return out


def compose(shot, lines, sub, out):
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / (H - 1)
        d.line([(0, y), (W, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)))
    f1, f2 = ImageFont.truetype(BOLD, 112), ImageFont.truetype(BOLD, 50)
    y = 150
    for line in lines:
        d.text((W / 2, y), line, font=f1, fill=(255, 255, 255), anchor="ma")
        y += 150
    d.text((W / 2, y + 26), sub, font=f2, fill=(255, 214, 170), anchor="ma")
    # 画面を角丸で縮小して置く（下は切れてよい）
    pw = 1060
    screen = Image.open(shot).convert("RGB")
    screen = screen.resize((pw, round(screen.height * pw / screen.width)), Image.LANCZOS)
    top = 620
    frame = Image.new("L", screen.size, 0)
    ImageDraw.Draw(frame).rounded_rectangle([0, 0, screen.width - 1, screen.height + 200], radius=90, fill=255)
    img.paste(screen, ((W - pw) // 2, top), frame)
    img.save(out, optimize=True)


if __name__ == "__main__":
    dest = Path(sys.argv[1])
    dest.mkdir(parents=True, exist_ok=True)
    raw = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    tmp = Path(tempfile.mkdtemp(prefix="shots_"))
    for name, query, lines, sub in SHOTS:
        shot = raw / f"{name}.png" if raw else capture(name, query, tmp)
        print(name, Image.open(shot).size)
        compose(shot, lines, sub, dest / f"{name}.png")
    shutil.rmtree(tmp, ignore_errors=True)
