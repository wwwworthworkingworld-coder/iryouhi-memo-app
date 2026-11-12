"""アプリが書き出すCSVを、実際の帳簿（build_kojin_sheet.py）に取り込んで確かめる。Excelが必要。
py test/verify_ledger.py <nodeのパス>
架空のデータだけを使い、試験ファイルはプロジェクトの外に作る。"""
import csv
import datetime as dt
import io
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import openpyxl

APP = Path(__file__).parent.parent
SRC = Path(r"G:\マイドライブ\256\BOOTH事業\src")
sys.path.insert(0, str(SRC))
import build_kojin_sheet as b  # noqa: E402

NODE = sys.argv[1] if len(sys.argv) > 1 else "node"
WORK = Path(tempfile.mkdtemp(prefix="keihi_ledger_"))
# G:ドライブ上の.ps1は実行ポリシーで止まるのでコピーして使う
PS = WORK / "imp_flow.ps1"
shutil.copy(SRC / "tests" / "imp_flow.ps1", PS)

JS = r"""
const { ALL, PAYS, csv } = require(process.argv[1]);
const list = ALL.map((cat, i) => ({ date: `2026-${String(i % 12 + 1).padStart(2, "0")}-15`, amount: 1000 + i, cat, pay: PAYS[i % PAYS.length],
  memo: i === 0 ? '店,"名"' : "試験" + i, rate: i === 1 ? 0.5 : "" }));
process.stdout.write(csv(list));
"""
text = subprocess.run([NODE, "-e", JS, str(APP / "www" / "core.js")], capture_output=True, encoding="utf-8", check=True).stdout
assert text.startswith("\ufeff")
rows = list(csv.reader(io.StringIO(text.lstrip("\ufeff"), newline="")))
fails = 0


def ok(label, cond):
    global fails
    fails += not cond
    print(("PASS " if cond else "FAIL ") + label)


def excel(path):
    out = subprocess.run(["powershell", "-ExecutionPolicy", "Bypass", "-File", str(PS), "-Path", str(path)],
                         capture_output=True, text=True, encoding="cp932", errors="replace")
    line = [l for l in out.stdout.splitlines() if l.startswith("RESULT")]
    assert line, out.stdout[-300:] + out.stderr[-500:]
    return dict(kv.split("=") for kv in line[0].split()[1:])


for mode in ("kojin", "fukugyo"):
    path = WORK / f"{mode}.xlsx"
    b.build(True, path, sample=False, mode=mode)
    wb = openpyxl.load_workbook(path)
    ws = wb["明細貼り付け"]
    for i, r in enumerate(rows):
        for j, v in enumerate(r):
            if v != "":
                ws.cell(row=3 + i, column=1 + j, value=v)   # 文字のまま貼る（CSVをそのまま読んだ形）
    wb.save(path)
    res = excel(path)
    wb = openpyxl.load_workbook(path, data_only=True)
    imp, ti = wb["明細取り込み"], wb["取引入力"]
    n = len(rows) - 1
    ok(f"[{mode}] 種類を自動で判定：{imp['A7'].value}", "スマホ経費メモ" in str(imp["A7"].value))
    ok(f"[{mode}] {n}行すべて取り込める（{res['before']}行）", res["before"] == str(n))
    ok(f"[{mode}] 取り込み後は新しい行なし（{res['after']}行）", res["after"] == "0")
    ok(f"[{mode}] 循環参照なし", res["circ"] == "none")
    got = sorted((ti.cell(row=r, column=5).value, ti.cell(row=r, column=2).value, ti.cell(row=r, column=4).value) for r in range(6, 6 + n))
    want = sorted((r[2], r[3], int(r[1])) for r in rows[1:])
    ok(f"[{mode}] 科目・支払方法・金額がCSVと同じ", got == want)
    if got != want:
        print("  差", [x for x in got if x not in want][:5], [x for x in want if x not in got][:5])
    dates = sorted(str(ti.cell(row=r, column=1).value)[:10] for r in range(6, 6 + n))
    ok(f"[{mode}] 日付", dates == sorted(r[0].replace("/", "-") for r in rows[1:]))
    memo0 = [ti.cell(row=r, column=7).value for r in range(6, 6 + n) if ti.cell(row=r, column=5).value == rows[1][2]]
    ok(f"[{mode}] 内容のカンマと引用符：{memo0}", memo0 == ['店,"名"'])
    half = next(r for r in rows[1:] if r[5] == "0.5")
    rate = [ti.cell(row=r, column=6).value for r in range(6, 6 + n) if ti.cell(row=r, column=5).value == half[2]]
    ok(f"[{mode}] 事業割合 50%：{rate}", rate == [0.5])
    err = sum(1 for s in wb.worksheets for row in s.iter_rows() for c in row if isinstance(c.value, str) and c.value.startswith("#") and c.value[1:4].isupper())
    ok(f"[{mode}] 数式エラーなし（{err}）", err == 0)

shutil.rmtree(WORK, ignore_errors=True)
print("合格" if not fails else f"不合格 {fails}件")
sys.exit(1 if fails else 0)
