/* 画面に関係しない処理（医療費控除メモ）。Node からも require できる */
(function (root) {
  // 医療費の区分。国税庁「医療費集計フォーム」の4列と同じ
  const KINDS = [["care", "診療・治療"], ["drug", "医薬品の購入"], ["kaigo", "介護保険サービス"], ["other", "その他（交通費など）"]];
  const KIND_NAME = Object.fromEntries(KINDS);
  const DEDUCTION_CAP = 2000000;   // 医療費控除の上限（国税庁 No.1120）
  const THRESHOLD = 100000;        // 10万円。総所得金額等が200万円未満の人は所得の5%
  const TAX_RATES = [[0.05, "〜195万円"], [0.10, "〜330万円"], [0.20, "〜695万円"], [0.23, "〜900万円"], [0.33, "〜1,800万円"], [0.40, "〜4,000万円"], [0.45, "4,000万円超"]];

  const pad = n => String(n).padStart(2, "0");

  // 読み取った文字のかたまりを、上から順の行にまとめる（「領収金額」と「¥1,980」が別のかたまりになるため）
  function groupLines(items) {
    const sorted = items.filter(i => i.text && i.text.trim()).map(i => ({ ...i, cy: i.y + i.h / 2 })).sort((a, b) => b.cy - a.cy);
    const rows = [];
    sorted.forEach(i => {
      const row = rows.find(r => Math.abs(r.cy - i.cy) < Math.min(r.h, i.h) * 0.6);
      if (row) { row.items.push(i); row.cy = row.items.reduce((s, x) => s + x.cy, 0) / row.items.length; }
      else rows.push({ cy: i.cy, h: i.h, items: [i] });
    });
    return rows.sort((a, b) => b.cy - a.cy).map(r => r.items.sort((a, b) => a.x - b.x).map(x => x.text.trim()).join(" ")).join("\n");
  }

  // 施設の名前らしい行を見分ける
  const PLACE_WORDS = /病院|クリニック|医院|歯科|診療所|薬局|調剤|ドラッグ|薬店|医療|療院|接骨|整骨|鍼灸|はりきゅう|眼科|内科|外科|小児科|皮膚科|耳鼻|産婦人科|整形|心療|メンタル|センター|介護|デイサービス|タクシー/;
  const KIND_RULES = [
    [/薬局|調剤|ドラッグ|薬店|くすり|クスリ/, "drug"],
    [/介護|デイサービス|訪問看護|ケアプラン|老人保健|特別養護/, "kaigo"],
    [/タクシー|交通|鉄道|バス|JR|電車/, "other"],
  ];

  // 読み取った文字から、日付・金額・施設名・区分の候補を取り出す
  function parseReceipt(raw, now = new Date()) {
    const h = s => s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[，]/g, ",").replace(/[．]/g, ".").replace(/[／]/g, "/").replace(/[：]/g, ":").replace(/[￥]/g, "¥");
    const lines = raw.split(/\r?\n/).map(l => h(l).replace(/\s+/g, "")).filter(Boolean);
    const all = lines.join("\n");
    // 日付（病院の領収書は令和表記が多い）
    let date = "";
    const okDate = (y, m, d) => {
      if (m < 1 || m > 12 || d < 1 || d > 31) return false;
      const t = new Date(y, m - 1, d), diff = (now - t) / 864e5;
      return t.getMonth() === m - 1 && diff > -2 && diff < 400;
    };
    const allS = raw.split(/\r?\n/).map(l => h(l).replace(/\s+/g, " ").trim()).join("\n");
    const pats = [
      [/(20\d\d) ?[年\/\-.] ?(\d{1,2}) ?[月\/\-.] ?(\d{1,2})(?!\d)/, m => [+m[1], +m[2], +m[3]]],
      [/(?:令和|R\.?|令) ?(\d{1,2}) ?[年\/.] ?(\d{1,2}) ?[月\/.] ?(\d{1,2})(?!\d)/, m => [2018 + +m[1], +m[2], +m[3]]],
      [/(?:^|[^\d])(\d\d)[\/.](\d{1,2})[\/.](\d{1,2})(?!\d)/, m => [2000 + +m[1], +m[2], +m[3]]],
    ];
    for (const text of [allS, all]) {
      for (const [re, f] of pats) {
        const m = text.match(re);
        if (m) { const [y, mo, d] = f(m); if (okDate(y, mo, d)) { date = `${y}-${pad(mo)}-${pad(d)}`; break; } }
      }
      if (date) break;
    }
    // 金額（行の中の数字。電話番号・登録番号・日付・時刻・点数は除く）
    const nums = l => {
      const t = l.replace(/T\d{13}/g, "").replace(/\d{2,4}-\d{2,4}-\d{3,4}/g, "")
        .replace(/(20\d\d|令和\d{1,2}|R\d{1,2})[年\/\-.]\d{1,2}[月\/\-.]\d{1,2}日?/g, "").replace(/\d{1,2}:\d{2}/g, "");
      return (t.match(/¥?\d{1,3}(?:[,.]\d{3})+|¥?\d+/g) || [])
        .map(x => +x.replace(/[¥,.]/g, "")).filter(v => v > 0 && v < 10000000);
    };
    // 点数・割合・回数は金額ではない。小計・預り・釣りも採らない
    const NOT = /小計|預|釣|対象|消費税|内税|税額|税率|点数|保険点|点|単位|回数|日数|割合|負担割|割(?![引])|%|％|個|ポイント|pt|割引|値引|クーポン|現金|カード|クレジット|電子マネー|QR|PayPay|番号|No/i;
    // 病院・薬局の領収書に多い言い方を優先する
    const LEVELS = [/領収金額|領収額|御領収額|ご領収金額|領収済額/, /請求金額|ご請求額|請求額|お支払金額|お支払額|お支払い金額|支払金額|負担額|一部負担金|患者負担額|患者負担/, /合計|総計|総額|税込計/, /計/];
    let amount = 0;
    for (const re of LEVELS) {
      for (let i = 0; i < lines.length && !amount; i++) {
        const m = lines[i].match(re); if (!m) continue;
        const head = lines[i].slice(0, m.index + m[0].length), rest = lines[i].slice(m.index + m[0].length);
        if (/小計|保険点|点数|単位/.test(head)) continue;
        const cut = rest.split(NOT)[0];
        if (cut !== rest && !/\d/.test(cut)) continue;
        let v = nums(cut);
        if (!v.length && cut === rest && lines[i + 1]) v = nums(lines[i + 1]);  // 金額が次の行にあるレシート
        if (v.length) amount = Math.max(...v);
      }
      if (amount) break;
    }
    if (!amount) {
      const v = lines.filter(l => /¥|円/.test(l) && !/預|釣|点/.test(l)).flatMap(nums);
      if (v.length) amount = Math.max(...v);
    }
    // 施設の名前（上のほうの日本語の行。病院・薬局らしい言葉がある行を優先）
    const SKIP = /領収|レシート|明細|計|請求|金額|毎度|ありがと|いらっしゃ|電話|TEL|FAX|〒|登録番号|都|道|府|県|市|区|町|丁目|番地|\d{2,}|様|殿|患者|氏名|保険|診療日|発行/i;
    const head = lines.slice(0, 8);
    const place = (head.find(l => PLACE_WORDS.test(l) && !/領収|明細|患者|様/.test(l)) || head.find(l => /[ぁ-んァ-ヶ一-龠]{2,}/.test(l) && !SKIP.test(l)) || "")
      .replace(/^(医療法人|社会医療法人|医療法人社団|医療法人財団|一般財団法人|社会福祉法人|株式会社|有限会社)/, "").slice(0, 20);
    const rule = KIND_RULES.find(([re]) => re.test(all));
    const kind = rule ? rule[1] : "care";
    // ドラッグストアのレシートは、医薬品でないもの（日用品）が混ざる
    const mixed = kind === "drug" && /ドラッグ|薬店|日用|食品|雑貨|ポイント/.test(all);
    return { date, amount, place, kind, mixed };
  }

  // 年の集計
  const inYear = (r, y) => r.date.slice(0, 4) === String(y);
  function summarize(records, year) {
    const list = records.filter(r => inYear(r, year));
    const sum = (arr, k) => arr.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    const by = key => {
      const m = new Map();
      list.forEach(r => { const k = r[key] || "（未設定）"; const o = m.get(k) || { name: k, total: 0, refund: 0, count: 0 }; o.total += r.amount; o.refund += Number(r.refund) || 0; o.count++; m.set(k, o); });
      return [...m.values()].sort((a, b) => b.total - a.total);
    };
    const byKind = KINDS.map(([k, name]) => ({ kind: k, name, total: sum(list.filter(r => r.kind === k), "amount") })).filter(x => x.total);
    return { year, count: list.length, total: sum(list, "amount"), refund: sum(list, "refund"), byPerson: by("person"), byPlace: by("place"), byKind };
  }

  // 控除額の目安。income は総所得金額等（分からなければ空で 10万円を使う）
  function deduction(total, refund, income) {
    const base = Math.max(0, total - refund);
    const threshold = income > 0 ? Math.min(THRESHOLD, Math.floor(income * 0.05)) : THRESHOLD;
    const amount = Math.max(0, Math.min(DEDUCTION_CAP, base - threshold));
    return { base, threshold, amount, remaining: Math.max(0, threshold - base) };
  }
  // 戻ってくる税金の目安。所得税は復興特別所得税を含めた率、住民税は10%
  function refundEstimate(ded, rate) {
    const incomeTax = Math.floor(Math.round(ded * rate * 100) * 1021 / 100000);  // 浮動小数の誤差を避ける
    const residentTax = Math.floor(ded * 0.10);
    return { incomeTax, residentTax, total: incomeTax + residentTax };
  }

  // 集計フォームの行にする。mode "group"：家族×施設×区分でまとめる（日付なし）。"each"：1件ずつ（日付あり）
  function formRows(records, year, mode = "group") {
    const list = records.filter(r => inYear(r, year) && r.amount > 0);
    if (mode === "each") {
      return list.slice().sort((a, b) => (a.person + a.date).localeCompare(b.person + b.date))
        .map(r => ({ person: r.person, place: r.place, kinds: [r.kind], amount: r.amount, refund: Number(r.refund) || 0, date: r.date }));
    }
    const m = new Map();
    list.forEach(r => {
      const k = [r.person, r.place, r.kind].join("\u0001");
      const o = m.get(k) || { person: r.person, place: r.place, kinds: [r.kind], amount: 0, refund: 0 };
      o.amount += r.amount; o.refund += Number(r.refund) || 0; m.set(k, o);
    });
    return [...m.values()].sort((a, b) => (a.person + a.place).localeCompare(b.person + b.place));
  }

  // CSV（Excel で開く用。見出しは集計フォームの列名に合わせる）
  function csv(records, year) {
    const q = s => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    const list = records.filter(r => !year || inYear(r, year)).slice().sort((a, b) => a.date.localeCompare(b.date));
    const lines = ["支払年月日,医療を受けた人,病院・薬局などの名称,医療費の区分,支払った医療費の金額,補填される金額,メモ"].concat(
      list.map(r => [r.date.replace(/-/g, "/"), q(r.person || ""), q(r.place || ""), KIND_NAME[r.kind] || "", r.amount, Number(r.refund) || "", q(r.memo || "")].join(",")));
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  // 機種変更用のバックアップ（利用者が自分で保存するファイル。どこにも送らない）
  function backup(data) {
    return JSON.stringify({ app: "iryouhi-memo", version: 1, exported: new Date().toISOString(), people: data.people || [], settings: data.settings || {}, records: data.records || [] });
  }
  function restore(text) {
    const o = JSON.parse(text);
    if (!o || o.app !== "iryouhi-memo" || !Array.isArray(o.records)) throw new Error("このアプリのバックアップではありません");
    const records = o.records.filter(r => r && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number(r.amount) > 0)
      .map(r => ({ id: String(r.id || Math.random().toString(36).slice(2)), date: r.date, person: String(r.person || ""), place: String(r.place || ""),
        kind: KIND_NAME[r.kind] ? r.kind : "care", amount: Math.round(Number(r.amount)), refund: Math.round(Number(r.refund) || 0), memo: String(r.memo || "").slice(0, 60) }));
    return { people: Array.isArray(o.people) ? o.people.map(String).slice(0, 20) : [], settings: o.settings || {}, records };
  }

  const api = { KINDS, KIND_NAME, TAX_RATES, THRESHOLD, DEDUCTION_CAP, groupLines, parseReceipt, summarize, deduction, refundEstimate, formRows, csv, backup, restore };
  if (typeof module !== "undefined") module.exports = api; else root.IryouhiCore = api;
})(this);
