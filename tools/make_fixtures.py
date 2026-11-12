"""試験用の架空のレシート画像を作る（実際のレシートは使わない）。py tools/make_fixtures.py"""
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).parent.parent / "test" / "fixtures"
FONT = r"C:\Windows\Fonts\meiryo.ttc"

# (ファイル名, 行, 期待する結果)。行は文字列か (左, 右)
RECEIPTS = [
    ("clinic", ["医療法人 みどり内科クリニック", "領収書", "見本 太郎 様", "令和8年2月3日", "東京都港区港南1-2-3", "TEL 03-1234-5678",
                ("初・再診料", "74点"), ("投薬", "68点"), ("合計点数", "142点"), ("負担割合", "3割"), ("領収金額", "¥1,230"), ("保険外負担", "¥0")],
     {"date": "2026-02-03", "amount": 1230, "place": "みどり内科クリニック", "kind": "care"}),
    ("pharmacy", ["さくら薬局 駅前店", "領収書（調剤）", "2026/02/03 11:20", ("調剤技術料", "120点"), ("薬学管理料", "45点"), ("薬剤料", "905点"),
                  ("合計点数", "1,070点"), ("一部負担金", "¥3,210"), ("お預り", "¥5,000"), ("お釣り", "¥1,790")],
     {"date": "2026-02-03", "amount": 3210, "place": "さくら薬局駅前店", "kind": "drug"}),
    ("dental", ["ひまわり歯科医院", "横浜市中区1-1-1", "領収書", "2026年7月21日", ("保険診療", "¥2,540"), ("自費診療", "¥36,000"), ("合計", "¥38,540"), ("お支払金額", "¥38,540")],
     {"date": "2026-07-21", "amount": 38540, "place": "ひまわり歯科医院", "kind": "care"}),
    ("drugstore", ["サンプルドラッグ 品川店", "2026/10/24 18:02", ("かぜ薬 12錠", "¥1,280"), ("ティッシュ", "¥298"), ("小計", "¥1,578"), ("合計", "¥1,578"), ("現金", "¥2,000"), ("お釣", "¥422")],
     {"date": "2026-10-24", "amount": 1578, "place": "サンプルドラッグ品川店", "kind": "drug"}),
    ("taxi", ["みどりタクシー", "領収書", "26/08/03 22:10", ("運賃", "2,300円"), ("迎車料", "400円"), ("お支払金額", "2,700円")],
     {"date": "2026-08-03", "amount": 2700, "place": "みどりタクシー", "kind": "other"}),
]


def render(lines, tilt=0.0, noise=False):
    w, lh = 720, 58
    font = ImageFont.truetype(FONT, 34)
    img = Image.new("RGB", (w, lh * len(lines) + 120), (250, 249, 244))
    d = ImageDraw.Draw(img)
    y = 60
    for line in lines:
        if isinstance(line, tuple):
            d.text((50, y), line[0], font=font, fill=(35, 35, 35))
            tw = d.textlength(line[1], font=font)
            d.text((w - 50 - tw, y), line[1], font=font, fill=(35, 35, 35))
        else:
            d.text((50, y), line, font=font, fill=(35, 35, 35))
        y += lh
    if tilt:
        img = img.rotate(tilt, expand=True, fillcolor=(180, 180, 175), resample=Image.BICUBIC)
    if noise:
        img = img.filter(ImageFilter.GaussianBlur(0.8))
        px = img.load()
        rnd = random.Random(1)
        for _ in range(img.width * img.height // 60):
            x, yy = rnd.randrange(img.width), rnd.randrange(img.height)
            c = rnd.randrange(150, 255)
            px[x, yy] = (c, c, c)
    return img


OUT.mkdir(parents=True, exist_ok=True)
expected = {}
for name, lines, want in RECEIPTS:
    render(lines).save(OUT / f"{name}.png")
    expected[name] = want
    render(lines, tilt=1.5, noise=True).save(OUT / f"{name}_rough.png")
    expected[f"{name}_rough"] = want
(OUT / "expected.json").write_text(json.dumps(expected, ensure_ascii=False, indent=1), encoding="utf-8")
print("ok", len(expected))
