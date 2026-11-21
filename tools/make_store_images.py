"""App Store の画像（1320×2868）を作る。画面は架空のデータ。
py tools/make_store_images.py <出力先> [撮影済みの画面のフォルダー]
撮影済みのフォルダーがなければ、Chromeで www を開いて撮る（tools/serve_test.py 8767 を別に起動しておく）。
型：生成りの地に見出し 1 行と短い説明、画面は縁取りして中央（経費メモ・請求書の「グラデ＋太字 2 行」の型は使わない）。"""
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
PAPER, INK, PLUM, AMBER, EDGE = (250, 247, 242), (42, 34, 39), (123, 45, 94), (217, 150, 43), (232, 225, 216)
SHOTS = [
    ("1_family", "?seed=1&shot=1", "あといくらで医療費控除？", "家族ごとに今年の医療費がたまり、控除までの残りがひと目で"),
    ("2_record", "?seed=1&shot=1&scan=1", "領収書から、3タップで記録", "誰の・どこの・いくら。読み取りは端末の中だけ"),
    ("3_form", "?seed=1&shot=1#settings", "国税庁の集計フォームに書き出し", "確定申告書等作成コーナーで読み込めば、明細の打ち直しなし"),
    ("4_person", "?seed=1&shot=1#person=%E8%A6%8B%E6%9C%AC%20%E5%A4%AA%E9%83%8E", "家族別・病院別に1年分", "戻る税金の目安、通院の交通費も"),
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


def compose(shot, title, sub, out):
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    # 上に梅色の細い帯（しるし）
    d.rounded_rectangle([W / 2 - 60, 120, W / 2 + 60, 134], radius=7, fill=AMBER)
    size = 84
    f1 = ImageFont.truetype(BOLD, size)
    while d.textlength(title, font=f1) > W - 120 and size > 56:   # 長い見出しは縮める
        size -= 4; f1 = ImageFont.truetype(BOLD, size)
    f2 = ImageFont.truetype(BOLD, 44)
    d.text((W / 2, 200), title, font=f1, fill=PLUM, anchor="ma")
    d.text((W / 2, 330), sub, font=f2, fill=INK, anchor="ma")
    # 画面：縁取りして中央に置く（下は切れてよい）
    pw = 1040
    screen = Image.open(shot).convert("RGB")
    screen = screen.resize((pw, round(screen.height * pw / screen.width)), Image.LANCZOS)
    top = 470
    x = (W - pw) // 2
    d.rounded_rectangle([x - 14, top - 14, x + pw + 14, top + screen.height + 220], radius=96, fill=EDGE)
    frame = Image.new("L", screen.size, 0)
    ImageDraw.Draw(frame).rounded_rectangle([0, 0, screen.width - 1, screen.height + 200], radius=84, fill=255)
    img.paste(screen, (x, top), frame)
    img.save(out, optimize=True)


if __name__ == "__main__":
    dest = Path(sys.argv[1])
    dest.mkdir(parents=True, exist_ok=True)
    raw = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    tmp = Path(tempfile.mkdtemp(prefix="shots_"))
    for name, query, title, sub in SHOTS:
        shot = raw / f"{name}.png" if raw else capture(name, query, tmp)
        print(name, Image.open(shot).size)
        compose(shot, title, sub, dest / f"{name}.png")
        Image.open(dest / f"{name}.png").resize((1206, 2622), Image.LANCZOS).save(dest / "1206x2622" / f"{name}.png", optimize=True) if (dest / "1206x2622").is_dir() else None
    shutil.rmtree(tmp, ignore_errors=True)
