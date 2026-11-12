// node test/core.test.js [読み取り結果のJSON]
// JSONを渡すと、CIのMacでVisionが読んだ結果を parseReceipt にかけて、期待どおりか確かめる
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { KINDS, groupLines, parseReceipt, matchPerson, summarize, netTotal, deduction, selfMedication, compareDeductions, refundEstimate, formRows, csv, backup, restore } = require("../www/core.js");
const { writeForm, validate, normalizeRow, MAX_ROWS, KIND_COL } = require("../www/xlsx.js");
const fflate = require("../www/vendor/fflate.min.js");

const NOW = new Date(2026, 11, 20);
let n = 0;
const t = (name, f) => { f(); n++; console.log("ok  " + name); };
const box = rows => rows.flatMap((r, i) => {
  const y = 0.95 - i * 0.05;
  return Array.isArray(r) ? [{ text: r[1], x: 0.7, y, w: 0.2, h: 0.03 }, { text: r[0], x: 0.1, y: y + 0.002, w: 0.2, h: 0.03 }] : [{ text: r, x: 0.1, y, w: 0.5, h: 0.03 }];
});
const rec = (date, person, place, kind, amount, refund = 0, memo = "", otc = false) => ({ id: Math.random().toString(36).slice(2), date, person, place, kind, amount, refund, memo, otc });
const SAMPLE = [
  rec("2026-02-03", "見本 太郎", "みどり内科クリニック", "care", 12340),
  rec("2026-02-03", "見本 太郎", "さくら薬局", "drug", 3210),
  rec("2026-05-10", "見本 太郎", "みどり内科クリニック", "care", 2660),
  rec("2026-07-21", "見本 花子", "ひまわり歯科", "care", 85000, 20000),
  rec("2026-07-21", "見本 花子", "電車・バス", "other", 1200),
  rec("2025-12-28", "見本 太郎", "去年の病院", "care", 50000),
];

// ---- 読み取り
t("病院の領収書：領収金額を採り、保険点数を金額と間違えない", () => {
  const r = parseReceipt(groupLines(box(["医療法人 みどり内科クリニック", "領収書", "見本 太郎 様", "令和8年2月3日",
    ["初・再診料", "74点"], ["投薬", "68点"], ["合計点数", "142点"], ["保険 負担割合", "3割"], ["領収金額", "¥1,230"]])), NOW);
  assert.deepStrictEqual([r.date, r.amount, r.place, r.kind], ["2026-02-03", 1230, "みどり内科クリニック", "care"]);
});
t("薬局の領収書：一部負担金と区分「医薬品」", () => {
  const r = parseReceipt(groupLines(box(["さくら薬局 駅前店", "2026/02/03 11:20", ["調剤技術料", "120点"], ["薬学管理料", "45点"], ["一部負担金", "¥3,210"], ["お預り", "¥5,000"], ["お釣り", "¥1,790"]])), NOW);
  assert.deepStrictEqual([r.date, r.amount, r.place, r.kind], ["2026-02-03", 3210, "さくら薬局駅前店", "drug"]);
});
t("ドラッグストアのレシートは日用品が混ざる印が付く", () => {
  const r = parseReceipt(groupLines(box(["サンプルドラッグ 品川店", "2026/10/24", ["かぜ薬", "¥1,280"], ["ティッシュ 日用品", "¥298"], ["合計", "¥1,578"]])), NOW);
  assert.strictEqual(r.kind, "drug"); assert.strictEqual(r.mixed, true); assert.strictEqual(r.amount, 1578);
});
t("タクシーは「その他」", () => {
  assert.strictEqual(parseReceipt("みどりタクシー\n26/08/03 22:10\nお支払金額 2,700円", NOW).kind, "other");
});
t("合計点数だけで金額がない領収書は金額 0", () => {
  assert.strictEqual(parseReceipt("病院\n合計点数 142点\n負担割合 3割", NOW).amount, 0);
});
t("未来の日付は採らない", () => { assert.strictEqual(parseReceipt("2027/10/24\n領収金額 100", NOW).date, ""); });
t("「R8.2.3」の日付", () => { assert.strictEqual(parseReceipt("R8.2.3\n領収金額 100", NOW).date, "2026-02-03"); });

t("受診者：「〇〇 様」「患者氏名」の行から名前を取り、家族の名前に当てる", () => {
  assert.strictEqual(parseReceipt("みどり内科クリニック\n領収書\n見本 太郎 様\n領収金額 ¥1,230", NOW).patient, "見本 太郎");
  assert.strictEqual(parseReceipt("さくら薬局\n患者氏名：見本 花子\n一部負担金 ¥3,210", NOW).patient, "見本 花子");
  assert.strictEqual(parseReceipt("サンプルドラッグ\n2026/10/24\n合計 ¥1,578", NOW).patient, "");
  assert.strictEqual(matchPerson("見本太郎", ["見本 花子", "見本 太郎"]), "見本 太郎");
  assert.strictEqual(matchPerson("見本 はな", ["見本 花子"]), "");
  assert.strictEqual(matchPerson("", ["見本 花子"]), "");
});

// ---- 集計と控除
t("年の集計：去年の分は入らない", () => {
  const s = summarize(SAMPLE, 2026);
  assert.strictEqual(s.count, 5); assert.strictEqual(s.total, 104410); assert.strictEqual(s.refund, 20000);
  assert.strictEqual(s.byPerson[0].name, "見本 花子"); assert.strictEqual(s.byPerson[0].total, 86200);
  assert.deepStrictEqual(s.byKind.map(k => k.kind), ["care", "drug", "other"]);
});
t("控除の目安：10万円を引く。所得200万円未満は5%", () => {
  assert.strictEqual(deduction(104410, 20000, 0).amount, 0);        // 84,410 − 100,000 < 0
  assert.strictEqual(deduction(104410, 20000, 0).remaining, 15590);
  assert.strictEqual(deduction(300000, 0, 5000000).amount, 200000);
  assert.strictEqual(deduction(300000, 0, 1500000).threshold, 75000);
  assert.strictEqual(deduction(3000000, 0, 0).amount, 2000000);     // 上限 200万円
});
t("補填はその医療費からだけ引く：引ききれない分は他の医療費から引かない", () => {
  const recs = [rec("2026-01-10", "A", "病院", "care", 50000, 80000), rec("2026-02-10", "A", "歯科", "care", 30000)];
  assert.strictEqual(netTotal(recs, 2026), 30000);  // 50,000−80,000 は 0。30,000 はそのまま
  assert.strictEqual(netTotal(SAMPLE, 2026), 84410);
});
t("セルフメディケーション税制の目安：12,000円を超えた分、上限 88,000円。印のある市販薬だけ", () => {
  const otc = [rec("2026-03-01", "A", "ドラッグ", "drug", 10000, 0, "", true), rec("2026-04-01", "A", "ドラッグ", "drug", 8000, 0, "", true),
    rec("2026-05-01", "A", "薬局", "drug", 5000, 0, "", false), rec("2026-05-02", "A", "病院", "care", 90000, 0, "", true)];
  const sm = selfMedication(otc, 2026);
  assert.deepStrictEqual([sm.total, sm.amount, sm.remaining], [18000, 6000, 0]);
  assert.strictEqual(selfMedication([rec("2026-01-01", "A", "ド", "drug", 150000, 0, "", true)], 2026).amount, 88000);
  assert.strictEqual(selfMedication([rec("2026-01-01", "A", "ド", "drug", 10000, 0, "", true)], 2026).remaining, 2000);
  assert.strictEqual(summarize(otc, 2026).otcTotal, 18000);
});
t("通常の医療費控除とセルフメディケーション税制の比較", () => {
  const few = [rec("2026-03-01", "A", "ドラッグ", "drug", 40000, 0, "", true), rec("2026-04-01", "A", "病院", "care", 30000)];
  const c1 = compareDeductions(few, 2026, 0);
  assert.strictEqual(c1.regular.amount, 0); assert.strictEqual(c1.selfmed.amount, 28000); assert.strictEqual(c1.better, "selfmed");
  const many = few.concat([rec("2026-06-01", "A", "病院", "care", 200000)]);
  const c2 = compareDeductions(many, 2026, 0);
  assert.strictEqual(c2.regular.amount, 170000); assert.strictEqual(c2.better, "regular"); assert.strictEqual(c2.diff, 142000);
  assert.strictEqual(compareDeductions([rec("2026-01-01", "A", "病院", "care", 1000)], 2026, 0).better, "none");
});
t("戻る税金の目安：所得税率×1.021 と住民税 10%", () => {
  const e = refundEstimate(200000, 0.10);
  assert.deepStrictEqual([e.incomeTax, e.residentTax, e.total], [20420, 20000, 40420]);
});

// ---- 集計フォーム
t("フォームの行：家族×施設×区分でまとめる", () => {
  const rows = formRows(SAMPLE, 2026);
  assert.strictEqual(rows.length, 4);
  const clinic = rows.find(r => r.place === "みどり内科クリニック");
  assert.strictEqual(clinic.amount, 15000); assert.strictEqual(clinic.date, undefined);
  assert.strictEqual(rows.find(r => r.place === "ひまわり歯科").refund, 20000);
});
t("フォームの行：1件ずつ（日付つき）", () => {
  const rows = formRows(SAMPLE, 2026, "each");
  assert.strictEqual(rows.length, 5); assert.ok(rows.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date)));
});
t("入力規則：名前は10文字・施設は20文字に切る、金額は整数", () => {
  const nr = normalizeRow({ person: "あいうえおかきくけこさしすせそ", place: "病".repeat(30), kinds: ["care"], amount: 1234.6, refund: "", date: "2026-01-02" });
  assert.strictEqual(nr.person.length, 10); assert.strictEqual(nr.place.length, 20); assert.strictEqual(nr.amount, 1235); assert.strictEqual(nr.date, "2026/01/02");
});
t("確認：空の名前・0円・行数超過を見つける", () => {
  assert.ok(validate([]).length);
  assert.ok(validate([{ person: "", place: "x", kinds: ["care"], amount: 1 }])[0].includes("医療を受けた人"));
  assert.ok(validate(Array.from({ length: MAX_ROWS + 1 }, () => ({ person: "a", place: "b", kinds: ["care"], amount: 1 })))[0].includes("行数"));
});
t("集計フォームの列：原本の見出し（6〜7行目）と書き込む列が一致する", () => {
  const tpl = new Uint8Array(fs.readFileSync(path.join(__dirname, "../www/form/iryouhi_form_v3.1.xlsx")));
  const files = fflate.unzipSync(tpl), dec = new TextDecoder();
  const sst = [...dec.decode(files["xl/sharedStrings.xml"]).matchAll(/<si>(.*?)<\/si>/gs)].map(m => m[1].replace(/<rPh.*?<\/rPh>/gs, "").replace(/<[^>]+>/g, ""));
  const sheet = dec.decode(files["xl/worksheets/sheet1.xml"]);
  const cell = ref => { const m = sheet.match(new RegExp(`<c r="${ref}"[^>]*t="s"[^>]*><v>(\\d+)</v>`)); return m ? sst[+m[1]] : ""; };
  assert.strictEqual(cell("A1").replace(/\s+/g, " ").trim(), "医療費集計フォーム Ver.3.1");
  assert.deepStrictEqual([cell("B6"), cell("C6"), cell("H6"), cell("I6"), cell("J6")], ["医療を受けた人", "病院・薬局などの名称", "支払った医療費の金額", "左のうち、補填される金額", "支払年月日"]);
  assert.ok(cell("D6").startsWith("医療費の区分"));
  assert.deepStrictEqual([cell("D7"), cell("E7"), cell("F7"), cell("G7")], ["診療・治療", "医薬品購入", "介護保険サービス", "その他の医療費"]);
  assert.deepStrictEqual(KIND_COL, { care: "D", drug: "E", kaigo: "F", other: "G" });
  assert.deepStrictEqual(KINDS.map(k => k[1]), ["診療・治療", "医薬品の購入", "介護保険サービス", "その他（交通費など）"]);
  assert.deepStrictEqual([cell("B7"), cell("C7"), cell("H7")], ["（全角10文字以内）", "（全角20文字以内）", "（半角数字９桁以内）"]);
  assert.strictEqual(cell("M2"), "該当する");
  assert.ok(sheet.includes('sqref="D9:G1003"') && sheet.includes('sqref="H9:I1003"'), "入力規則の範囲は 9〜1003 行");
  assert.strictEqual(MAX_ROWS, 995);
});
t("集計フォームの金額：書き込んだ H・I 列の合計が、アプリの集計と一致する", () => {
  const tpl = new Uint8Array(fs.readFileSync(path.join(__dirname, "../www/form/iryouhi_form_v3.1.xlsx")));
  for (const mode of ["group", "each"]) {
    const rows = formRows(SAMPLE, 2026, mode);
    const sheet = new TextDecoder().decode(fflate.unzipSync(writeForm(rows, tpl, fflate))["xl/worksheets/sheet1.xml"]);
    const col = c => [...sheet.matchAll(new RegExp(`<c r="${c}(\\d+)" s="5"><v>(\\d+)</v></c>`, "g"))].filter(m => +m[1] >= 9).reduce((a, m) => a + +m[2], 0);
    const s = summarize(SAMPLE, 2026);
    assert.strictEqual(col("H"), s.total, mode); assert.strictEqual(col("I"), s.refund, mode);
    assert.strictEqual([...sheet.matchAll(/<c r="B(\d+)" s="6" t="s">/g)].filter(m => +m[1] >= 9).length, rows.length, mode + "：行数");
  }
});
t("xlsx を書き出し、原本の構造（シート名・保護・入力規則・共有数式）が残る", () => {
  const tpl = new Uint8Array(fs.readFileSync(path.join(__dirname, "../www/form/iryouhi_form_v3.1.xlsx")));
  const out = writeForm(formRows(SAMPLE, 2026), tpl, fflate);
  const files = fflate.unzipSync(out);
  const dec = new TextDecoder();
  const sheet = dec.decode(files["xl/worksheets/sheet1.xml"]), sst = dec.decode(files["xl/sharedStrings.xml"]), wb = dec.decode(files["xl/workbook.xml"]);
  assert.strictEqual(Object.keys(files).length, 34);
  assert.ok(wb.includes('name="医療費集計フォーム"') && wb.includes("workbookProtection"));
  assert.ok(sheet.includes("<sheetProtection") && sheet.includes('<dataValidations count="4">'));
  assert.ok(sheet.includes('<f t="shared" ref="A11:A74" si="0">ROW()-8</f>'), "共有数式の親セルが残る");
  assert.ok(/<c r="H9" s="5"><v>\d+<\/v><\/c>/.test(sheet));
  assert.ok(/<c r="D\d+" s="6" t="s"><v>1<\/v><\/c>/.test(sheet) && /<c r="E9" s="6" t="s"><v>1<\/v><\/c>/.test(sheet), "「該当する」は原本の共有文字列 1 番を使う（1行目は文字コード順で さくら薬局＝医薬品）");
  assert.ok(sst.includes("<t xml:space=\"preserve\">見本 太郎</t>"));
  const uniq = +sst.match(/uniqueCount="(\d+)"/)[1];
  assert.strictEqual(uniq, 82 + new Set(["見本 太郎", "見本 花子", "みどり内科クリニック", "さくら薬局", "ひまわり歯科", "電車・バス"]).size);
  assert.ok(sheet.includes("<v>104410</v>") && sheet.includes("<v>20000</v>"), "C3・C4 の計算結果");
  fs.writeFileSync(path.join(require("os").tmpdir(), "iryouhi_form_test.xlsx"), out);  // 手で Excel で開いて確かめる用（プロジェクトの外）
});
t("xlsx：読み取り文字に XML で使えない文字や記号が入っても壊れない", () => {
  const tpl = new Uint8Array(fs.readFileSync(path.join(__dirname, "../www/form/iryouhi_form_v3.1.xlsx")));
  const out = writeForm([{ person: "A&B <x>", place: "\u0007\"病院\"", kinds: ["care", "drug"], amount: 1, refund: 0, date: "2026-01-01" }], tpl, fflate);
  const sheet = new TextDecoder().decode(fflate.unzipSync(out)["xl/worksheets/sheet1.xml"]);
  assert.ok(/<c r="E9" s="6" t="s">/.test(sheet));
  const sst = new TextDecoder().decode(fflate.unzipSync(out)["xl/sharedStrings.xml"]);
  assert.ok(sst.includes("A&amp;B &lt;x&gt;") && sst.includes("&quot;病院&quot;") && !sst.includes("\u0007"));
});

// ---- CSV・バックアップ
t("CSV の見出しと行", () => {
  const s = csv(SAMPLE, 2026);
  assert.ok(s.startsWith("﻿支払年月日,医療を受けた人,病院・薬局などの名称,医療費の区分,支払った医療費の金額,補填される金額,セルフメディケーション税制の対象,メモ\r\n2026/02/03,見本 太郎,"));
  assert.ok(s.includes("2026/07/21,見本 花子,ひまわり歯科,診療・治療,85000,20000,,\r\n"));
  assert.ok(csv(SAMPLE.concat([rec("2026-03-01", "見本 太郎", "サンプルドラッグ", "drug", 4000, 0, "", true)]), 2026).includes("サンプルドラッグ,医薬品の購入,4000,,対象,"));
  assert.ok(!s.includes("去年の病院"));
});
t("バックアップを書いて戻すと同じ記録になる", () => {
  const d = restore(backup({ people: ["見本 太郎", "見本 花子"], settings: { income: 5000000 }, records: SAMPLE }));
  assert.strictEqual(d.records.length, SAMPLE.length); assert.deepStrictEqual(d.people, ["見本 太郎", "見本 花子"]); assert.strictEqual(d.settings.income, 5000000);
  assert.throws(() => restore('{"app":"other"}'));
});
t("区分は集計フォームの4列", () => { assert.deepStrictEqual(KINDS.map(k => k[0]), ["care", "drug", "kaigo", "other"]); });

const file = process.argv[2];
if (file) {
  const res = JSON.parse(fs.readFileSync(file, "utf8"));
  const want = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "expected.json"), "utf8"));
  let bad = 0;
  for (const [name, w] of Object.entries(want)) {
    const text = groupLines(res[name] || []);
    const r = parseReceipt(text, NOW);
    const miss = Object.keys(w).filter(k => k === "place" ? r.place.replace(/\s/g, "") !== w.place.replace(/\s/g, "") : r[k] !== w[k]);
    console.log(`${miss.length ? "NG " : "ok "} ${name}: ${JSON.stringify(r)}`);
    if (miss.length) { bad += /_rough$/.test(name) || miss.join() === "place" ? 0 : 1; console.log(text.replace(/^/gm, "    ")); }
  }
  assert.strictEqual(bad, 0, "きれいな画像で日付・金額・区分を読み取れないものがある");
}
console.log(`${n}件 合格`);
