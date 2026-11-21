(async () => {
  const { KINDS, KIND_NAME, TAX_RATES, groupLines, parseReceipt, matchPerson, sameDayVisits, transportFor, summarize, filterRecords, filterSummary, shouldAskReview, netTotal, deduction, compareDeductions, refundEstimate, formRows, csv, backup, restore } = window.IryouhiCore;
  const { writeForm, validate } = window.IryouhiXlsx;
  const KEY = "iryouhi-memo-v1";
  const PRIVACY_URL = "https://256company.com/iryouhi-app-privacy.html";
  const SUPPORT_URL = "https://256company.com/iryouhi-app-support.html";
  const REVIEW_URL = "https://apps.apple.com/jp/app/id6834021732?action=write-review";
  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const P = native ? window.Capacitor.Plugins : {};
  const reader = () => window.IryouhiMock || P.IryouhiReceipt;   // IryouhiMock は画面確認用
  const form = () => window.IryouhiFormMock || P.IryouhiForm;      // 集計フォームの購入（StoreKit 2）とレビュー依頼
  const $ = id => document.getElementById(id);
  const yen = v => "¥" + Number(v || 0).toLocaleString("ja-JP");
  const pad = n => String(n).padStart(2, "0");
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const RING = 2 * Math.PI * 52;

  // ---- 保存（アプリ専用の領域。この端末の中だけ。形は 1.0 と同じ）
  const EMPTY = () => ({ records: [], people: [], settings: { income: "", rate: 0.10, launches: 0, reviewAsked: false } });
  async function load() {
    try {
      const raw = native ? (await P.Preferences.get({ key: KEY })).value : localStorage.getItem(KEY);
      const d = Object.assign(EMPTY(), JSON.parse(raw || "{}"));
      d.settings = Object.assign(EMPTY().settings, d.settings || {});
      return d;
    } catch (e) { return EMPTY(); }
  }
  async function save() {
    const value = JSON.stringify(data);
    try {
      if (native) await P.Preferences.set({ key: KEY, value }); else localStorage.setItem(KEY, value);
      return true;
    } catch (e) { toast("保存できませんでした"); return false; }
  }

  let data = await load();
  let viewYear = +today().slice(0, 4);
  let viewMonth = today().slice(0, 7);
  let page = "home";
  let person = "";          // その人のページで見ている人
  let personPlace = "";     // その人のページの病院の絞り込み
  let purchased = false;
  let rec = { person: data.people[0] || "", kind: "care", editing: null, mixed: false, otc: false };

  let tId;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(tId); tId = setTimeout(() => t.classList.remove("show"), 2600); }
  const years = () => { const s = new Set(data.records.map(r => +r.date.slice(0, 4))); s.add(+today().slice(0, 4)); return [...s].sort((a, b) => b - a); };
  const initial = name => { const parts = String(name || "").trim().split(/[\s　]+/); return (parts[parts.length - 1] || "").slice(0, 1) || "？"; };  // 「見本 太郎」→「太」
  function chips(el, list, selected, onPick, extra) {
    el.innerHTML = "";
    list.forEach(([value, label]) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = label;
      b.setAttribute("aria-pressed", String(selected === value));
      b.onclick = () => onPick(value);
      el.appendChild(b);
    });
    if (extra) el.appendChild(extra);
  }

  // ---- ページの切り替え（家族の今年 → その人 ／ すべて ／ 書き出しと設定）
  const PAGES = { home: "医療費控除メモ", person: "", all: "すべての記録", settings: "書き出しと設定" };
  function show(name) {
    page = name;
    Object.keys(PAGES).forEach(k => { $("page-" + k).hidden = k !== name; });
    const home = name === "home";
    $("backBtn").hidden = home; $("yearNav").hidden = !home; $("openSettings").hidden = !home;
    $("fab").hidden = name === "settings";
    $("pageTitle").textContent = name === "person" ? person : PAGES[name];
    $("brand").classList.toggle("plain", !home);
    $("scroll").scrollTop = 0;
    if (home) renderHome();
    if (name === "person") renderPerson();
    if (name === "all") renderAll();
    if (name === "settings") renderSettings();
  }
  $("backBtn").onclick = () => show("home");
  $("openSettings").onclick = () => show("settings");

  // ---- 家族の今年
  function renderHome() {
    const s = summarize(data.records, viewYear);
    const ys = years();
    const income = Number(data.settings.income) || 0;
    $("yearLabel").textContent = `${viewYear}年`;
    $("prevYear").disabled = viewYear <= Math.min(...ys) - 1;
    $("nextYear").disabled = viewYear >= +today().slice(0, 4);
    // リング：補填はその医療費からだけ引く
    const net = netTotal(data.records, viewYear);
    const d = deduction(net, 0, income);
    const fill = $("ringFill");
    if (d.amount) {
      $("ringLabel").textContent = "控除の対象になる額（目安）";
      $("ringValue").textContent = yen(d.amount); $("ringValue").className = "over";
      fill.style.strokeDashoffset = "0px"; fill.classList.add("over");
      const e = refundEstimate(d.amount, data.settings.rate || 0.10);
      $("ringNote").textContent = `戻る税金の目安 約${yen(e.total)}（所得税率 ${Math.round((data.settings.rate || 0.10) * 100)}%）`;
    } else {
      $("ringLabel").textContent = "控除の対象まで あと";
      $("ringValue").textContent = yen(d.remaining); $("ringValue").className = "";
      fill.style.strokeDashoffset = (RING * (1 - Math.min(1, net / d.threshold))).toFixed(1) + "px"; fill.classList.remove("over");
      $("ringNote").textContent = s.count ? `今年の医療費 ${yen(net)}${s.refund ? "（補填を引いた額）" : ""}。${yen(d.threshold)} を超えた分が対象` : `病院・薬局の領収書をためると、ここに今年の合計と控除までの残りが出ます`;
    }
    $("familyMeta").textContent = s.count ? `${viewYear}年 ${s.count}件・${yen(s.total)}` : "";
    // 家族カード
    const fam = $("family"); fam.innerHTML = "";
    if (!data.people.length) {
      const c = document.createElement("div"); c.className = "fam intro";
      c.innerHTML = `<p>医療を受けた人の名前を入れると、家族ごとに今年の医療費がたまります。申告する本人と、生計を一にする家族。</p>`;
      const b = document.createElement("button"); b.type = "button"; b.className = "btn main"; b.textContent = "本人と家族の名前を入れる"; b.style.marginTop = "0";
      b.onclick = addPersonPrompt; c.appendChild(b); fam.appendChild(c);
    } else {
      data.people.forEach(name => {
        const p = s.byPerson.find(x => x.name === name) || { total: 0, count: 0, refund: 0 };
        const last = data.records.filter(r => r.person === name && r.date.slice(0, 4) === String(viewYear)).sort((a, b) => b.date.localeCompare(a.date))[0];
        const b = document.createElement("button"); b.type = "button"; b.className = "fam";
        b.innerHTML = `<span class="who"><span class="av">${esc(initial(name))}</span><span>${esc(name)}</span></span><span><b>${yen(p.total)}</b><small>${p.count ? `${p.count}件${last ? "・最後 " + last.date.slice(5).replace("-", "/") : ""}` : "今年の記録はまだありません"}</small></span>`;
        b.onclick = () => { person = name; personPlace = ""; show("person"); };
        fam.appendChild(b);
      });
      const add = document.createElement("button"); add.type = "button"; add.className = "fam add";
      add.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>家族を追加`;
      add.onclick = addPersonPrompt; fam.appendChild(add);
    }
    // 最近の記録
    const recent = data.records.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 5);
    renderRows($("recent"), recent, "まだ記録がありません。右下の「記録」から", false);
    // 病院・区分
    const max = Math.max(1, ...s.byPlace.map(x => x.total), ...s.byKind.map(x => x.total));
    const sumRows = (ul, arr, key) => {
      ul.innerHTML = "";
      if (!arr.length) { ul.innerHTML = '<li class="empty">今年の記録はありません</li>'; return; }
      arr.forEach(x => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="t">${esc(x.name)}<span class="bar"><i style="width:${Math.round(x.total / max * 100)}%"></i></span></span><span class="a">${yen(x.total)}<small>${x.count}件</small></span>`;
        li.setAttribute("role", "button");
        li.onclick = () => { person = ""; personPlace = ""; allFilter = key === "place" ? { place: x.name } : { kind: x.kind }; show("all"); };
        ul.appendChild(li);
      });
    };
    sumRows($("byPlace"), s.byPlace.slice(0, 12), "place");
    sumRows($("byKind"), s.byKind, "kind");
    $("foldBy").hidden = !s.count;
    $("homeHint").hidden = !s.count;
  }
  $("prevYear").onclick = () => { viewYear--; renderHome(); };
  $("nextYear").onclick = () => { viewYear++; renderHome(); };

  // 記録の行（最近・その人・すべて で共通）
  function renderRows(ul, list, emptyText, grouped) {
    ul.innerHTML = "";
    if (!list.length) { ul.innerHTML = `<li class="empty">${esc(emptyText)}</li>`; return; }
    let lastYm = "";
    list.forEach(i => {
      if (grouped && i.date.slice(0, 7) !== lastYm) {
        lastYm = i.date.slice(0, 7);
        const h = document.createElement("li"); h.className = "head"; h.textContent = `${+lastYm.slice(0, 4)}年${+lastYm.slice(5)}月`; ul.appendChild(h);
      }
      const li = document.createElement("li");
      li.innerHTML = `<span class="d">${i.date.slice(5).replace("-", "/")}</span>`
        + `<span class="t">${esc(i.place || "（名称なし）")}<small>${esc(i.person)}・${KIND_NAME[i.kind] || ""}${i.memo ? "・" + esc(i.memo) : ""}</small></span>`
        + `<span class="a">${yen(i.amount)}${i.refund ? `<small>補填 −${yen(i.refund)}</small>` : ""}${i.kind !== "other" ? `<br><button type="button" class="mini" aria-label="${esc(i.place || "")}の交通費を足す">＋交通費</button>` : ""}</span>`;
      li.setAttribute("role", "button");
      li.onclick = () => openEdit(i.id);
      const tr = li.querySelector(".mini");
      if (tr) tr.onclick = e => { e.stopPropagation(); startTransport(i); };
      ul.appendChild(li);
    });
  }

  // ---- その人のページ
  function renderPerson() {
    const mine = data.records.filter(r => r.person === person && r.date.slice(0, 4) === String(viewYear));
    const fs = filterSummary(mine);
    $("pTotal").textContent = yen(fs.total);
    $("pMeta").textContent = `${viewYear}年 ${fs.count}件${fs.refund ? `・補填 −${yen(fs.refund)}` : ""}`;
    const places = new Map();
    mine.forEach(r => { const k = r.place || "（名称なし）"; places.set(k, (places.get(k) || 0) + r.amount); });
    const list = [["", "すべて"]].concat([...places.entries()].sort((a, b) => b[1] - a[1]).map(([p, t]) => [p, `${p} ${yen(t)}`]));
    $("pPlaces").hidden = places.size < 2;
    chips($("pPlaces"), list, personPlace, p => { personPlace = p; renderPerson(); });
    const shown = mine.filter(r => !personPlace || (r.place || "（名称なし）") === personPlace).sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    renderRows($("pList"), shown, `${person} の ${viewYear}年の記録はありません`, true);
  }
  $("pRename").onclick = async () => {
    const used = data.records.filter(r => r.person === person).length;
    const name = (prompt(`名前を変えるときは新しい名前を入れてください。空にして OK を押すと一覧から外します（記録 ${used}件は残ります）。`, person) ?? null);
    if (name === null) return;
    const v = name.trim().slice(0, 10);
    if (!v) {
      if (!confirm(`${person} を家族の一覧から外しますか？`)) return;
      data.people = data.people.filter(x => x !== person); await save(); show("home"); return;
    }
    if (v !== person) {
      if (data.people.includes(v)) { toast("同じ名前があります"); return; }
      data.people = data.people.map(x => x === person ? v : x);
      data.records.forEach(r => { if (r.person === person) r.person = v; });
      person = v; await save(); toast("名前を変えました");
    }
    show("person");
  };

  // ---- すべての記録（月ごと。病院・区分の行から来たときはその条件で年全体）
  let allFilter = null;
  const shiftMonth = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  function renderAll() {
    let list;
    if (allFilter) {
      list = filterRecords(data.records, viewYear, allFilter).sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
      $("monthLabel").textContent = `${viewYear}年 ${allFilter.place || KIND_NAME[allFilter.kind]}`;
      $("prevMonth").hidden = $("nextMonth").hidden = true;
      $("prevMonth").disabled = false;
    } else {
      const [y, m] = viewMonth.split("-").map(Number);
      $("monthLabel").textContent = `${y}年${m}月`;
      $("prevMonth").hidden = $("nextMonth").hidden = false;
      $("nextMonth").disabled = viewMonth >= today().slice(0, 7);
      list = data.records.filter(i => i.date.startsWith(viewMonth)).sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    }
    const fs = filterSummary(list);
    $("monthTotal").textContent = list.length ? `${fs.count}件・${yen(fs.total)}${fs.refund ? `・補填 −${yen(fs.refund)}` : ""}` : "";
    renderRows($("allList"), list, allFilter ? "この条件の記録はありません" : "この月の記録はありません", !!allFilter);
  }
  $("prevMonth").onclick = () => { viewMonth = shiftMonth(viewMonth, -1); renderAll(); };
  $("nextMonth").onclick = () => { viewMonth = shiftMonth(viewMonth, 1); renderAll(); };
  $("seeAll").onclick = () => { allFilter = null; show("all"); };

  // ---- 控除の目安シート
  function openDed() {
    const s = summarize(data.records, viewYear);
    const income = Number(data.settings.income) || 0;
    const net = netTotal(data.records, viewYear);
    const d = deduction(net, 0, income);
    const e = refundEstimate(d.amount, data.settings.rate || 0.10);
    $("dedTitle").textContent = `${viewYear}年の控除の目安`;
    $("dedTotal").textContent = yen(s.total); $("dedCount").textContent = `${s.count}件`;
    $("dedRefundRow").hidden = !s.refund; $("dedRefundSum").textContent = `−${yen(s.refund)}`;
    $("dedThreshold").textContent = yen(d.threshold);
    $("dedThresholdNote").textContent = income && income < 2000000 ? "所得の5%" : "10万円";
    $("dedAmount").textContent = yen(d.amount); $("dedAmount").className = d.amount ? "" : "zero";
    $("dedRefund").textContent = d.amount ? `約${yen(e.total)}` : "—"; $("dedRefund").className = d.amount ? "" : "zero";
    $("dedNote").textContent = d.amount
      ? `所得税 約${yen(e.incomeTax)}（復興特別所得税込み）＋ 住民税 約${yen(e.residentTax)}。`
      : `あと ${yen(d.remaining)} で控除の対象になります。対象になると、所得税率に応じた戻る税金の目安が出ます。`;
    chips($("rateChips"), TAX_RATES.map(([r, label]) => [r, `${Math.round(r * 100)}%`]), data.settings.rate, async r => { data.settings.rate = r; await save(); openDed(); });
    const c = compareDeductions(data.records, viewYear, income);
    $("selfmedBox").hidden = !s.otcTotal;
    if (s.otcTotal) {
      $("smRegular").textContent = yen(c.regular.amount); $("smRegular").className = c.better === "regular" ? "" : "zero";
      $("smAmount").textContent = yen(c.selfmed.amount); $("smAmount").className = c.better === "selfmed" ? "" : "zero";
      $("smNote").textContent = `対象の市販薬 ${yen(c.selfmed.base)}` + (c.selfmed.amount ? ` − 12,000円 ＝ ${yen(c.selfmed.amount)}。` : `。あと ${yen(c.selfmed.remaining)} で 12,000円を超えます。`)
        + (c.better === "none" ? "" : c.better === "selfmed" ? ` 今の記録ではセルフメディケーション税制のほうが ${yen(c.diff)} 大きい目安です。` : ` 今の記録では通常の医療費控除のほうが ${yen(c.diff)} 大きい目安です。`);
    }
    openSheet("dedSheet");
  }
  $("ringCard").onclick = openDed;
  $("dedClose").onclick = closeSheets;

  // ---- シートの開閉
  function openSheet(id) { $("sheetBg").hidden = false; $(id).hidden = false; $(id).querySelector(".sheet-body").scrollTop = 0; }
  function closeSheets() {
    $("sheetBg").hidden = true; $("recSheet").hidden = true; $("dedSheet").hidden = true;
    if (rec.editing) resetRec();
    document.activeElement && document.activeElement.blur();
  }
  $("sheetBg").onclick = closeSheets;
  $("recClose").onclick = closeSheets;

  // ---- 記録シート（誰の → どこの → いくら。区分は自動、変えるときだけ開く）
  const KIND_NOTES = {
    care: "診療・治療、治療のための歯科・あんま・鍼灸・柔道整復、入院費（差額ベッド代は対象外）、出産の費用など。",
    drug: "処方薬と、治療のために買った市販薬。ドラッグストアのレシートは、日用品や健康食品の分を除いた金額にします。",
    kaigo: "介護保険の居宅サービス・施設サービスのうち医療費控除の対象になる分。領収書に対象額が書かれています。",
    other: "通院の電車・バス代（タクシーは必要なときだけ）、医療用器具、療養上の世話の費用など。自家用車のガソリン代・駐車場代は対象外。",
  };
  function placeOptions() {
    const seen = new Map();
    data.records.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach(r => { if (r.place && !seen.has(r.place)) seen.set(r.place, r.kind); });
    $("placeList").innerHTML = [...seen.keys()].slice(0, 30).map(p => `<option value="${esc(p)}">`).join("");
    return seen;
  }
  function renderRec() {
    const add = document.createElement("button");
    add.type = "button"; add.className = "chip add"; add.textContent = data.people.length ? "＋ 追加" : "＋ 名前を追加";
    add.onclick = addPersonPrompt;
    chips($("people"), data.people.map(p => [p, p]), rec.person, p => { rec.person = p; renderRec(); }, add);
    const seen = placeOptions();
    const pc = $("placeChips"); pc.hidden = !seen.size;
    chips(pc, [...seen.keys()].slice(0, 6).map(p => [p, p]), $("place").value.trim(), p => { $("place").value = p; if (!rec.editing && seen.get(p)) rec.kind = seen.get(p); renderRec(); });
    chips($("kinds"), KINDS, rec.kind, k => { rec.kind = k; renderRec(); });
    $("kindLabel").textContent = KIND_NAME[rec.kind];
    $("kindNote").textContent = KIND_NOTES[rec.kind] + (rec.mixed && rec.kind === "drug" ? " このレシートには医薬品でないものが混ざっているかもしれません。" : "");
    $("otcRow").hidden = rec.kind !== "drug";
    $("otcChip").setAttribute("aria-pressed", String(rec.kind === "drug" && !!rec.otc));
    $("recTitle").textContent = rec.editing ? "記録の修正" : "記録";
    $("saveBtn").textContent = rec.editing ? "修正を保存" : "この内容で記録";
    $("deleteBtn").hidden = !rec.editing;
    $("readRow").hidden = !!rec.editing;
    renderSameDay();
  }
  function renderSameDay() {
    const date = $("date").value;
    const visits = rec.editing ? [] : sameDayVisits(data.records, date, rec.editing);
    $("sameDay").hidden = !visits.length || rec.kind === "other";
    if (!visits.length) return;
    const el = $("sameDayChips"); el.innerHTML = "";
    visits.forEach(v => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip visit";
      b.innerHTML = `${esc(v.place || "（名称なし）")}<small>${esc(v.person)}・${yen(v.amount)}</small>`;
      b.onclick = () => startTransport(v);
      el.appendChild(b);
    });
  }
  $("date").onchange = renderSameDay;
  $("kindBtn").onclick = () => { const open = $("kindBox").hidden; $("kindBox").hidden = !open; $("kindBtn").setAttribute("aria-expanded", String(open)); };
  $("otcChip").onclick = () => { rec.otc = !rec.otc; renderRec(); };
  function resetRec() {
    rec = { person: rec.person || data.people[0] || "", kind: "care", editing: null, mixed: false, otc: false };
    $("amount").value = ""; $("place").value = ""; $("refund").value = ""; $("memo").value = ""; $("date").value = today();
    $("ocrBox").hidden = true; $("kindBox").hidden = true; $("kindBtn").setAttribute("aria-expanded", "false");
  }
  function openRec() { if (!rec.editing) resetRec(); renderRec(); openSheet("recSheet"); }
  $("fab").onclick = () => { rec.editing = null; openRec(); };
  function openEdit(id) {
    const i = data.records.find(x => x.id === id); if (!i) return;
    rec = { person: i.person, kind: i.kind, editing: id, mixed: false, otc: !!i.otc };
    $("date").value = i.date; $("amount").value = i.amount; $("place").value = i.place || ""; $("refund").value = i.refund || ""; $("memo").value = i.memo || "";
    $("ocrBox").hidden = true; $("kindBox").hidden = !(i.refund || i.memo || i.otc); $("kindBtn").setAttribute("aria-expanded", String(!$("kindBox").hidden));
    renderRec(); openSheet("recSheet");
  }
  async function addPersonPrompt() {
    const name = (prompt("医療を受けた人の名前（10文字まで）。申告する本人と家族。") || "").trim().slice(0, 10);
    if (!name) return;
    if (!data.people.includes(name)) data.people.push(name);
    rec.person = name;
    await save();
    if ($("recSheet").hidden) renderHome(); else renderRec();
    if (page === "settings") renderPeople();
  }
  function readRec() {
    const amount = Math.round(Number($("amount").value));
    if (!rec.person) { toast("誰の医療費かを選んでください（＋で追加）"); return null; }
    const place = $("place").value.trim();
    if (!place) { toast("病院・薬局などの名称を入れてください"); $("place").focus(); return null; }
    if (!(amount > 0)) { toast("金額を入れてください"); $("amount").focus(); return null; }
    const refund = Math.max(0, Math.round(Number($("refund").value) || 0));
    if (refund > amount) { toast("補填される金額が支払った金額を超えています"); return null; }
    return { date: $("date").value || today(), amount, person: rec.person, place, kind: rec.kind, refund, otc: rec.kind === "drug" && !!rec.otc, memo: $("memo").value.trim() };
  }
  $("form").onsubmit = async e => {
    e.preventDefault();
    const r = readRec(); if (!r) return;
    const wasEditing = !!rec.editing;
    let saved;
    if (wasEditing) { saved = data.records.find(x => x.id === rec.editing); Object.assign(saved, r); }
    else { saved = Object.assign({ id: newId() }, r); data.records.push(saved); }
    if (!await save()) return;
    rec.editing = null; resetRec(); closeSheets();
    toast(wasEditing ? "修正しました" : "記録しました");
    if (!wasEditing && r.kind !== "other") afterSave(saved); else $("afterBar").hidden = true;
    if (page !== "home" && !wasEditing) show("home"); else show(page);
  };
  $("deleteBtn").onclick = async () => {
    const i = data.records.find(x => x.id === rec.editing); if (!i) return;
    if (!confirm(`${i.date.replace(/-/g, "/")} ${i.place} ${yen(i.amount)} を削除しますか？`)) return;
    data.records = data.records.filter(x => x.id !== i.id);
    await save(); rec.editing = null; resetRec(); closeSheets(); toast("削除しました"); show(page);
  };
  // 記録のあと：その通院の交通費を足す案内（押すまで残る。閉じれば消える）
  let afterRec = null;
  function afterSave(r) { afterRec = r; $("afterText").textContent = `${r.place} の通院、交通費はありますか？`; $("afterBar").hidden = false; }
  $("afterBtn").onclick = () => { if (afterRec) startTransport(afterRec); $("afterBar").hidden = true; };
  $("afterClose").onclick = () => { $("afterBar").hidden = true; };
  function startTransport(visit) {
    const t = transportFor(visit);
    rec = { person: t.person, kind: "other", editing: null, mixed: false, otc: false };
    $("date").value = t.date; $("amount").value = ""; $("refund").value = ""; $("place").value = t.place; $("memo").value = t.memo;
    $("ocrBox").hidden = true; $("kindBox").hidden = true; $("kindBtn").setAttribute("aria-expanded", "false");
    $("afterBar").hidden = true;
    renderRec(); openSheet("recSheet");
    setTimeout(() => $("amount").focus(), 60);
  }

  // ---- 領収書の読み取り（端末の中だけ。写真は残さない）
  function ocrNote(text, preview) {
    $("ocrBox").hidden = false;
    $("ocrNote").textContent = text;
    $("ocrImg").setAttribute("src", preview ? "data:image/jpeg;base64," + preview : "");
  }
  async function readReceipt(method) {
    if (!reader()) { toast("この環境では読み取れません"); return; }
    let res;
    try { res = await reader()[method](); }
    catch (e) { ocrNote(e.message || "読み取れませんでした"); return; }
    if (res.cancelled) return;
    if (res.unsupported) { toast("この端末ではカメラを使えません。「写真から」を使ってください"); return; }
    const r = parseReceipt(groupLines(res.items || []));
    const g = res.guess || {};   // 端末側（Swift）が医療の領収書向けに出した候補を優先
    const date = g.date || r.date, amount = g.amount || r.amount, place = g.place || r.place, patient = g.patient || r.patient;
    if (date) $("date").value = date;
    if (amount) $("amount").value = amount;
    if (place) { $("place").value = place; const known = placeOptions().get(place); if (known) r.kind = known; }
    rec.kind = r.kind; rec.mixed = r.mixed;
    const who = matchPerson(patient, data.people);
    if (who) rec.person = who;
    const text = (res.items || []).map(i => i.text || "").join("\n");
    rec.otc = r.kind === "drug" && /セルフメディケーション|★|☆/.test(text);
    renderRec();
    const got = [date && "日付", amount && "金額", place && "名称", who && "受診者"].filter(Boolean);
    ocrNote(got.length
      ? `${got.join("・")}を読み取りました。${who ? "" : "誰の医療費かを選び、"}違っていたら直して「この内容で記録」。` + (amount ? "" : "金額（領収金額・負担額）は読み取れなかったので入れてください。")
      : "読み取れませんでした。明るい場所で撮り直すか、手で入力してください。", res.preview);
  }
  $("readBtn").onclick = () => readReceipt("captureReceipt");
  $("pickBtn").onclick = () => readReceipt("readFromLibrary");

  // ---- ファイルの書き出し（共有シート。利用者が保存先を選ぶ）
  async function shareFile(bytes, name, mime) {
    if (!native) {
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes], { type: mime })); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      return true;
    }
    const isText = typeof bytes === "string";
    let b64 = "";
    if (!isText) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); b64 = btoa(s); }
    const { uri } = await P.Filesystem.writeFile(isText ? { path: name, data: bytes, directory: "CACHE", encoding: "utf8" } : { path: name, data: b64, directory: "CACHE" });
    try { await P.Share.share({ title: name, files: [uri], dialogTitle: name }); return true; }
    catch (e) { if (/cancel/i.test(e.message || "")) return false; throw e; }
  }

  // ---- 書き出しと設定
  let template = null;
  async function loadTemplate() {
    if (template) return template;
    const res = await fetch("form/iryouhi_form_v3.1.xlsx");
    if (!res.ok) throw new Error("フォームの原本を読めませんでした");
    template = new Uint8Array(await res.arrayBuffer());
    return template;
  }
  function renderSettings() {
    const sel = $("formYear"), cur = sel.value;
    sel.innerHTML = years().map(y => `<option value="${y}">${y}年分</option>`).join("");
    sel.value = years().includes(+cur) ? cur : String(years()[0]);
    renderFormPreview();
    renderPeople();
    $("income").value = data.settings.income || "";
    renderBuy();
  }
  function renderFormPreview() {
    const y = +$("formYear").value;
    const rows = formRows(data.records, y, $("formMode").value);
    const s = summarize(data.records, y);
    $("formPreview").textContent = rows.length
      ? `${y}年分：${rows.length}行、医療費 ${yen(s.total)}${s.refund ? `、補填 ${yen(s.refund)}` : ""}。国税庁の様式 Ver.3.1。読み込み後は作成コーナーの画面で内容を確かめてください。`
      : `${y}年分の記録はありません`;
    $("exportForm").disabled = !rows.length;
  }
  $("formYear").onchange = renderFormPreview; $("formMode").onchange = renderFormPreview;
  function renderBuy() { $("buyBox").hidden = purchased; $("exportForm").hidden = !purchased; }
  async function checkPurchased() {
    try {
      if (!form()) { purchased = !native; return; }   // ブラウザ確認では購入済みとして動かす
      purchased = !!(await form().status()).owned;
      if (!purchased) {
        const o = await form().offer();
        if (o && o.price) $("buyBtn").textContent = `${o.price} で購入して書き出せるようにする`;
      }
    } catch (e) { purchased = false; }
    renderBuy();
  }
  $("buyBtn").onclick = async () => {
    if (!form()) { toast("この環境では購入できません"); return; }
    $("buyBtn").disabled = true;
    try {
      const r = await form().unlock();
      if (r.state === "purchased") { purchased = true; toast("ありがとうございます。書き出せるようになりました"); }
      else if (r.state === "pending") toast("承認待ちです。承認されると書き出せるようになります");
    } catch (e) { toast("購入できませんでした"); }
    $("buyBtn").disabled = false; renderBuy();
  };
  $("restoreBtn").onclick = async () => {
    if (!form()) return;
    try { purchased = !!(await form().recover()).owned; toast(purchased ? "購入を復元しました" : "この Apple アカウントでの購入は見つかりませんでした"); }
    catch (e) { toast("復元できませんでした"); }
    renderBuy();
  };
  $("exportForm").onclick = async () => {
    const y = +$("formYear").value;
    const rows = formRows(data.records, y, $("formMode").value);
    const bad = validate(rows);
    if (bad.length) { toast(bad[0]); return; }
    try {
      const bytes = writeForm(rows, await loadTemplate(), window.fflate);
      if (await shareFile(bytes, `iryouhi_form_${y}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) { toast(`${rows.length}行を書き出しました`); maybeAskReview(true); }
    } catch (e) { toast(e.message || "書き出せませんでした"); }
  };
  $("exportCsv").onclick = async () => {
    const y = +$("formYear").value;
    if (!data.records.some(r => r.date.startsWith(String(y)))) { toast("書き出す記録がありません"); return; }
    try { if (await shareFile(csv(data.records, y), `iryouhi_${y}.csv`, "text/csv")) toast("CSV を書き出しました"); }
    catch (e) { toast("書き出せませんでした"); }
  };
  function renderPeople() {
    const ul = $("peopleList"); ul.innerHTML = "";
    if (!data.people.length) { ul.innerHTML = '<li class="empty">まだ登録がありません。本人と家族の名前を追加してください</li>'; return; }
    data.people.forEach(p => {
      const li = document.createElement("li"); li.style.gridTemplateColumns = "1fr auto";
      li.innerHTML = `<span class="t">${esc(p)}</span><button type="button" class="del" aria-label="${esc(p)}を外す">外す</button>`;
      li.querySelector("button").onclick = async () => {
        const used = data.records.filter(r => r.person === p).length;
        if (!confirm(used ? `${p} を一覧から外しますか？ 記録 ${used}件はそのまま残ります。` : `${p} を外しますか？`)) return;
        data.people = data.people.filter(x => x !== p);
        if (rec.person === p) rec.person = data.people[0] || "";
        await save(); renderPeople();
      };
      ul.appendChild(li);
    });
  }
  $("addPerson").onclick = async () => {
    const name = $("newPerson").value.trim().slice(0, 10);
    if (!name) return;
    if (!data.people.includes(name)) data.people.push(name);
    if (!rec.person) rec.person = name;
    $("newPerson").value = "";
    await save(); renderPeople();
  };
  $("income").onchange = async () => { const v = Math.max(0, Math.round(Number($("income").value) || 0)); data.settings.income = v || ""; $("income").value = v || ""; await save(); };
  $("backupBtn").onclick = async () => {
    try { if (await shareFile(backup(data), `iryouhi-memo_backup_${today().replace(/-/g, "")}.json`, "application/json")) toast("ファイルに書き出しました"); }
    catch (e) { toast("書き出せませんでした"); }
  };
  $("restoreFile").onchange = async e => {
    const file = e.target.files[0]; e.target.value = ""; if (!file) return;
    try {
      const d = restore(await file.text());
      const mode = data.records.length ? confirm(`今の記録 ${data.records.length}件に、ファイルの ${d.records.length}件を追加しますか？\n（「キャンセル」で今の記録を置き換えます）`) : false;
      if (mode) {
        const have = new Set(data.records.map(r => [r.date, r.person, r.place, r.amount].join("|")));
        d.records.forEach(r => { if (!have.has([r.date, r.person, r.place, r.amount].join("|"))) data.records.push(r); });
        d.people.forEach(p => { if (!data.people.includes(p)) data.people.push(p); });
      } else {
        if (data.records.length && !confirm(`今の記録 ${data.records.length}件を消して、ファイルの ${d.records.length}件に置き換えます。よいですか？`)) return;
        data.records = d.records; data.people = d.people; data.settings = Object.assign(data.settings, d.settings);
      }
      rec.person = data.people[0] || "";
      await save(); renderSettings(); toast(`読み込みました（記録 ${data.records.length}件）`);
    } catch (err) { toast(err.message || "読み込めませんでした"); }
  };

  // ---- レビューのお願い（Apple の標準ダイアログ。出すかどうかは Apple が決める。こちらは 1 回だけ頼む）
  async function maybeAskReview(exported) {
    if (!native || !P.IryouhiForm) return;
    if (!shouldAskReview({ asked: data.settings.reviewAsked, launches: data.settings.launches, records: data.records.length, exported })) return;
    data.settings.reviewAsked = true;
    await save();
    setTimeout(() => { try { P.IryouhiForm.askReview(); } catch (e) { /* 出なくても何もしない */ } }, exported ? 1200 : 2000);
  }
  $("reviewBtn").onclick = () => window.open(REVIEW_URL, "_blank");
  $("privacyBtn").onclick = () => window.open(PRIVACY_URL, "_blank");
  $("supportBtn").onclick = () => window.open(SUPPORT_URL, "_blank");

  // ---- 起動
  $("date").value = today();
  checkPurchased();
  data.settings.launches = (Number(data.settings.launches) || 0) + 1;
  save().then(() => maybeAskReview(false));
  // 画面確認用：#settings／#all／#rec（記録シート）／#person=名前
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith("person=") && data.people.includes(h.slice(7))) { person = h.slice(7); show("person"); }
  else if (h === "settings" || h === "all") show(h);
  else { show("home"); if (h === "rec") openRec(); }
})();
