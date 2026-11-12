/* 国税庁「医療費集計フォーム」（iryouhi_form_v3.1.xlsx）に値を書き込む。
   原本（www/form/）を同梱し、zip の中の sheet1.xml と sharedStrings.xml だけを書き換える。
   構造・保護・入力規則は原本のまま。ブラウザ（fflate をグローバルに読み込む）でも Node でも動く */
(function (root) {
  const FIRST_ROW = 9, LAST_ROW = 1003, MAX_ROWS = LAST_ROW - FIRST_ROW + 1;  // 995 行（原本の「ご利用に当たって」のとおり）
  const KIND_COL = { care: "D", drug: "E", kaigo: "F", other: "G" };          // 診療・治療／医薬品購入／介護保険サービス／その他の医療費
  const LIMIT = { person: 10, place: 20, amount: 999999999 };                 // 原本の入力規則（全角10文字・20文字、0〜999,999,999 の整数）

  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // XML 1.0 で使えない制御文字を落とす（読み取り文字が混ざることがある）
  const clean = s => String(s || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();

  /** 1行分を原本の形に整える。長すぎる名前は切り、金額は整数に丸める */
  function normalizeRow(r) {
    const person = clean(r.person).slice(0, LIMIT.person).trim();
    const place = clean(r.place).slice(0, LIMIT.place).trim();
    const kinds = (r.kinds || [r.kind]).filter(k => KIND_COL[k]);
    const amount = Math.min(LIMIT.amount, Math.max(0, Math.round(Number(r.amount) || 0)));
    const refund = Math.min(LIMIT.amount, Math.max(0, Math.round(Number(r.refund) || 0)));
    const date = /^\d{4}-\d{2}-\d{2}$/.test(r.date || "") ? r.date.replace(/-/g, "/") : "";
    return { person, place, kinds, amount, refund, date };
  }

  /** 書き込む前の確認。問題があれば日本語の理由を返す（空配列なら OK） */
  function validate(rows) {
    const bad = [];
    if (!rows.length) bad.push("書き出す記録がありません");
    if (rows.length > MAX_ROWS) bad.push(`フォームに入る行数（${MAX_ROWS}行）を超えています。家族別・医療機関別にまとめて書き出してください`);
    rows.forEach((r, i) => {
      const n = normalizeRow(r);
      if (!n.person) bad.push(`${i + 1}行目：医療を受けた人が空です`);
      if (!n.place) bad.push(`${i + 1}行目：病院・薬局などの名称が空です`);
      if (!n.kinds.length) bad.push(`${i + 1}行目：医療費の区分がありません`);
      if (!(n.amount > 0)) bad.push(`${i + 1}行目：金額が 0 円です`);
    });
    return bad;
  }

  function cells(rowNo, n, sst, colA) {
    const c = (col, body) => `<c r="${col}${rowNo}"${body}`;
    const str = (col, s, style) => s ? c(col, ` s="${style}" t="s"><v>${sst.add(s)}</v></c>`) : c(col, ` s="${style}"/>`);
    const num = (col, v) => v ? c(col, ` s="5"><v>${v}</v></c>`) : c(col, ` s="5"/>`);
    const flag = col => n.kinds.some(k => KIND_COL[k] === col) ? c(col, ` s="6" t="s"><v>${sst.add("該当する")}</v></c>`) : c(col, ` s="6"/>`);
    return [
      colA,  // No 列は原本のまま（共有数式の親セルを壊さない）
      str("B", n.person, 6), str("C", n.place, 6),
      flag("D"), flag("E"), flag("F"), flag("G"),
      num("H", n.amount), num("I", n.refund),
      str("J", n.date, 40),
      c("K", ` s="7"/>`),
    ].join("");
  }

  /** 共有文字列表。原本にある文字はその番号を使い、新しい文字は末尾に足す */
  function sharedStrings(xml) {
    const list = [];
    const re = /<si>(.*?)<\/si>/gs; let m;
    while ((m = re.exec(xml))) list.push(m[1].replace(/<rPh.*?<\/rPh>/gs, "").replace(/<phoneticPr[^>]*\/>/g, "").replace(/<[^>]+>/g, ""));
    const index = new Map(); list.forEach((s, i) => { if (!index.has(s)) index.set(s, i); });
    const added = [];
    return {
      add(s) { if (index.has(s)) return index.get(s); const i = list.length + added.length; index.set(s, i); added.push(s); return i; },
      build(usedCount) {
        const body = added.map(s => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("");
        const total = list.length + added.length;
        return xml.replace(/count="\d+"/, `count="${usedCount}"`).replace(/uniqueCount="\d+"/, `uniqueCount="${total}"`).replace("</sst>", body + "</sst>");
      },
    };
  }

  /**
   * rows: [{ person, place, kind | kinds:[], amount, refund, date:"YYYY-MM-DD" }]
   * template: 原本の xlsx（Uint8Array）。fflate: fflate のモジュール。戻りは書き込み済みの xlsx（Uint8Array）
   */
  function writeForm(rows, template, fflate) {
    const bad = validate(rows);
    if (bad.length) throw new Error(bad[0]);
    const files = fflate.unzipSync(template);
    const dec = new TextDecoder(), enc = new TextEncoder();
    const sheetPath = "xl/worksheets/sheet1.xml", sstPath = "xl/sharedStrings.xml", wbPath = "xl/workbook.xml";
    const sst = sharedStrings(dec.decode(files[sstPath]));
    let sheet = dec.decode(files[sheetPath]);
    let used = (dec.decode(files[sstPath]).match(/count="(\d+)"/) || [0, 0])[1] * 1;
    let sumH = 0, sumI = 0;
    rows.forEach((r, i) => {
      const n = normalizeRow(r), rowNo = FIRST_ROW + i;
      sumH += n.amount; sumI += n.refund;
      used += 2 + n.kinds.length + (n.date ? 1 : 0);
      const re = new RegExp(`<row r="${rowNo}"([^>]*)>.*?</row>`, "s");
      if (!re.test(sheet)) throw new Error(`原本に ${rowNo} 行目がありません`);
      sheet = sheet.replace(re, (m, attrs) => {
        const colA = (m.match(new RegExp(`<c r="A${rowNo}"[^>]*?(?:/>|>.*?</c>)`, "s")) || [""])[0];
        return `<row r="${rowNo}"${attrs}>${cells(rowNo, n, sst, colA)}</row>`;
      });
    });
    // 上部の合計（C3・C4）の計算結果も入れておく（開いたときに再計算されるが、計算しないソフトで見ても合うように）
    sheet = sheet.replace(/(<c r="C3"[^>]*>)<f>(.*?)<\/f><v\/>/, `$1<f>$2</f><v>${sumH || ""}</v>`)
                 .replace(/(<c r="C4"[^>]*>)<f>(.*?)<\/f><v\/>/, `$1<f>$2</f><v>${sumI || ""}</v>`);
    files[sheetPath] = enc.encode(sheet);
    files[sstPath] = enc.encode(sst.build(used));
    let wb = dec.decode(files[wbPath]);
    if (!/fullCalcOnLoad/.test(wb)) wb = wb.replace(/<calcPr /, '<calcPr fullCalcOnLoad="1" ');
    files[wbPath] = enc.encode(wb);
    const out = {};
    Object.keys(files).forEach(k => { out[k] = [files[k], { level: /\.png$|\.bin$/.test(k) ? 0 : 6 }]; });
    return fflate.zipSync(out);
  }

  const api = { writeForm, validate, normalizeRow, MAX_ROWS, LIMIT, KIND_COL };
  if (typeof module !== "undefined") module.exports = api; else root.IryouhiXlsx = api;
})(this);
