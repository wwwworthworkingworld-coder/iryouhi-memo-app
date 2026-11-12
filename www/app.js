(async () => {
  const { KINDS, KIND_NAME, TAX_RATES, groupLines, parseReceipt, summarize, deduction, refundEstimate, formRows, csv, backup, restore } = window.IryouhiCore;
  const { writeForm, validate } = window.IryouhiXlsx;
  const KEY = "iryouhi-memo-v1";
  const PRODUCT_ID = "com.company256.iryouhi.form";
  const PRIVACY_URL = "https://256company.com/iryouhi-app-privacy.html";
  const SUPPORT_URL = "https://256company.com/iryouhi-app-support.html";
  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const P = native ? window.Capacitor.Plugins : {};
  const scanner = () => window.IryouhiMock || P.KeihiScanner;   // IryouhiMock は画面確認用
  const store = () => window.IryouhiStoreMock || P.IryouhiStore;
  const $ = id => document.getElementById(id);
  const yen = v => "¥" + Number(v || 0).toLocaleString("ja-JP");
  const pad = n => String(n).padStart(2, "0");
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---- 保存（アプリ専用の領域。この端末の中だけ）
  const EMPTY = () => ({ records: [], people: [], settings: { income: "", rate: 0.10 } });
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
  let state = { person: data.people[0] || "", kind: "care", editing: null, mixed: false };
  let viewYear = +today().slice(0, 4);
  let viewMonth = today().slice(0, 7);
  let filterPerson = "";
  let purchased = false;

  // ---- 画面の切り替え
  const TITLES = { home: "集計", add: "記録", list: "一覧", more: "書き出し" };
  function showTab(name) {
    Object.keys(TITLES).forEach(k => { $("tab-" + k).hidden = k !== name; });
    document.querElement = null;
    document.querySelectorAll(".tabs button").forEach(b => {
      if (b.dataset.tab === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    $("title").textContent = state.editing && name === "add" ? "記録の修正" : TITLES[name];
    $("scroll").scrollTop = 0;
    if (name === "home") renderHome();
    if (name === "list") renderList();
    if (name === "more") renderMore();
    if (name === "add" && !state.editing) renderForm();
  }
  document.querySelectorAll(".tabs button").forEach(b => { b.onclick = () => { if (state.editing && b.dataset.tab !== "add") reset(); showTab(b.dataset.tab); }; });

  // ---- 共通の部品
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
  let tId;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(tId); tId = setTimeout(() => t.classList.remove("show"), 2400); }
  const years = () => { const s = new Set(data.records.map(r => +r.date.slice(0, 4))); s.add(+today().slice(0, 4)); return [...s].sort((a, b) => b - a); };

  // ---- 集計（ホーム）
  function renderHome() {
    const s = summarize(data.records, viewYear);
    const ys = years();
    $("yearLabel").textContent = `${viewYear}年分（${s.count}件）` + (s.refund ? `　補填 −${yen(s.refund)}` : "");
    $("yearTotal").textContent = yen(s.total);
    $("prevYear").disabled = viewYear <= Math.min(...ys) - 1;
    $("nextYear").disabled = viewYear >= +today().slice(0, 4);
    const empty = s.count === 0;
    $("emptyHome").hidden = !empty; $("homeBody").hidden = empty;
    if (empty) return;
    const income = Number(data.settings.income) || 0;
    const d = deduction(s.total, s.refund, income);
    const e = refundEstimate(d.amount, data.settings.rate || 0.10);
    $("dedAmount").textContent = yen(d.amount); $("dedAmount").className = d.amount ? "" : "zero";
    $("dedRefund").textContent = d.amount ? `約${yen(e.total)}` : "—"; $("dedRefund").className = d.amount ? "" : "zero";
    $("dedNote").textContent = d.amount
      ? `医療費 ${yen(s.total)}${s.refund ? ` − 補填 ${yen(s.refund)}` : ""} − ${yen(d.threshold)} ＝ ${yen(d.amount)}。所得税 約${yen(e.incomeTax)}（復興特別所得税込み）＋ 住民税 約${yen(e.residentTax)}。`
      : `医療費${s.refund ? "（補填を引いた額）" : ""}が ${yen(d.threshold)} を超えると控除の対象になります。あと ${yen(d.remaining)} です。`;
    chips($("rateChips"), TAX_RATES.map(([r, label]) => [r, `${Math.round(r * 100)}%`]), data.settings.rate, async r => { data.settings.rate = r; await save(); renderHome(); });
    const max = Math.max(1, ...s.byPerson.map(p => p.total));
    const rows = (ul, arr, label) => {
      ul.innerHTML = "";
      arr.forEach(x => {
        const li = document.createElement("li"); li.className = "sum";
        li.innerHTML = `<span class="t">${esc(label(x))}<div class="bar-wrap"><div class="bar-fill" style="width:${Math.round(x.total / max * 100)}%"></div></div></span>`
          + `<span class="a">${yen(x.total)}${x.refund ? `<small>補填 −${yen(x.refund)}</small>` : x.count ? `<small>${x.count}件</small>` : ""}</span>`;
        ul.appendChild(li);
      });
    };
    rows($("byPerson"), s.byPerson, x => x.name);
    rows($("byKind"), s.byKind, x => x.name);
    rows($("byPlace"), s.byPlace.slice(0, 12), x => x.name);
  }
  $("prevYear").onclick = () => { viewYear--; renderHome(); };
  $("nextYear").onclick = () => { viewYear++; renderHome(); };
  $("homeScan").onclick = () => { showTab("add"); readReceipt("scanReceipt"); };

  // ---- 記録
  const KIND_NOTES = {
    care: "診療・治療、治療のための歯科・あんま・鍼灸・柔道整復、入院費（差額ベッド代は対象外）、出産の費用など。",
    drug: "処方薬と、治療のために買った市販薬。ドラッグストアのレシートは、日用品や健康食品の分を除いた金額にします。",
    kaigo: "介護保険の居宅サービス・施設サービスのうち医療費控除の対象になる分。領収書に対象額が書かれています。",
    other: "通院の電車・バス代（タクシーは必要なときだけ）、医療用器具、療養上の世話の費用など。自家用車のガソリン代・駐車場代は対象外。",
  };
  function placeOptions() {
    const seen = new Map();
    data.records.slice().reverse().forEach(r => { if (r.place && !seen.has(r.place)) seen.set(r.place, r.kind); });
    $("placeList").innerHTML = [...seen.keys()].slice(0, 30).map(p => `<option value="${esc(p)}">`).join("");
    return seen;
  }
  function renderForm() {
    const add = document.createElement("button");
    add.type = "button"; add.className = "chip add"; add.textContent = data.people.length ? "＋ 追加" : "＋ 名前を追加";
    add.onclick = addPersonPrompt;
    chips($("people"), data.people.map(p => [p, p]), state.person, p => { state.person = p; renderForm(); }, add);
    chips($("kinds"), KINDS, state.kind, k => { state.kind = k; renderForm(); });
    $("kindNote").textContent = KIND_NOTES[state.kind] + (state.mixed && state.kind === "drug" ? " このレシートには医薬品でないものが混ざっているかもしれません。" : "");
    $("saveBtn").textContent = state.editing ? "修正を保存" : "記録する";
    $("editActions").hidden = !state.editing;
    $("transportBtn").hidden = !!state.editing;
    placeOptions();
  }
  async function addPersonPrompt() {
    const name = (prompt("医療を受けた人の名前（10文字まで）。申告する本人と家族。") || "").trim().slice(0, 10);
    if (!name) return;
    if (!data.people.includes(name)) data.people.push(name);
    state.person = name;
    await save(); renderForm(); renderPeople();
  }
  function reset() {
    const keepDate = state.editing ? today() : ($("date").value || today());
    state = { person: state.person || data.people[0] || "", kind: "care", editing: null, mixed: false };
    $("amount").value = ""; $("place").value = ""; $("refund").value = ""; $("memo").value = ""; $("date").value = keepDate;
    $("ocrBox").hidden = true;
    renderForm();
  }
  function readForm() {
    const amount = Math.round(Number($("amount").value));
    if (!(amount > 0)) { toast("金額を入れてください"); $("amount").focus(); return null; }
    if (!state.person) { toast("医療を受けた人を選んでください（＋で追加）"); return null; }
    const place = $("place").value.trim();
    if (!place) { toast("病院・薬局などの名称を入れてください"); $("place").focus(); return null; }
    const refund = Math.max(0, Math.round(Number($("refund").value) || 0));
    if (refund > amount) { toast("補填される金額が支払った金額を超えています"); return null; }
    return { date: $("date").value || today(), amount, person: state.person, place, kind: state.kind, refund, memo: $("memo").value.trim() };
  }
  async function saveRecord(rec, nextTab) {
    const wasEditing = !!state.editing;
    if (wasEditing) Object.assign(data.records.find(x => x.id === state.editing), rec);
    else data.records.push(Object.assign({ id: newId() }, rec));
    if (await save()) {
      document.activeElement && document.activeElement.blur();
      toast(wasEditing ? "修正しました" : "記録しました");
      reset();
      showTab(nextTab || (wasEditing ? "list" : "add"));
    }
  }
  $("form").onsubmit = e => { e.preventDefault(); const rec = readForm(); if (rec) saveRecord(rec); };
  // 通院の交通費：同じ人・同じ日で「その他」の記録を続けて作る
  $("transportBtn").onclick = async () => {
    const rec = readForm(); if (!rec) return;
    const wasEditing = !!state.editing;
    if (!wasEditing) { data.records.push(Object.assign({ id: newId() }, rec)); if (!await save()) return; toast("記録しました。続けて交通費を入れてください"); }
    const date = rec.date, person = rec.person;
    reset();
    $("date").value = date; state.person = person; state.kind = "other"; $("place").value = "電車・バス"; $("memo").value = "通院の交通費";
    renderForm(); $("amount").focus();
  };
  function edit(id) {
    const i = data.records.find(x => x.id === id); if (!i) return;
    state = { person: i.person, kind: i.kind, editing: id, mixed: false };
    $("date").value = i.date; $("amount").value = i.amount; $("place").value = i.place || ""; $("refund").value = i.refund || ""; $("memo").value = i.memo || "";
    $("ocrBox").hidden = true;
    renderForm(); showTab("add");
  }
  $("cancelBtn").onclick = () => { reset(); showTab("list"); };
  $("deleteBtn").onclick = async () => {
    const i = data.records.find(x => x.id === state.editing); if (!i) return;
    if (!confirm(`${i.date.replace(/-/g, "/")} ${i.place} ${yen(i.amount)} を削除しますか？`)) return;
    data.records = data.records.filter(x => x.id !== i.id);
    await save(); reset(); showTab("list"); toast("削除しました");
  };

  // ---- 一覧
  const shiftMonth = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  function renderList() {
    const [y, m] = viewMonth.split("-").map(Number);
    $("monthLabel").textContent = `${y}年${m}月の合計`;
    const all = data.records.filter(i => i.date.startsWith(viewMonth));
    const inMonth = all.filter(i => !filterPerson || i.person === filterPerson).sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    $("monthTotal").textContent = yen(inMonth.reduce((s, i) => s + i.amount, 0));
    $("nextMonth").disabled = viewMonth >= today().slice(0, 7);
    const pf = $("personFilter");
    if (data.people.length > 1) { pf.hidden = false; chips(pf, [["", "全員"]].concat(data.people.map(p => [p, p])), filterPerson, p => { filterPerson = p; renderList(); }); }
    else pf.hidden = true;
    const ul = $("list"); ul.innerHTML = "";
    if (!inMonth.length) { ul.innerHTML = '<li class="empty">この月の記録はありません</li>'; return; }
    inMonth.forEach(i => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="d">${i.date.slice(5).replace("-", "/")}</span>`
        + `<span class="t">${esc(i.place || "")}<small>${esc(i.person)}・${KIND_NAME[i.kind] || ""}${i.memo ? "・" + esc(i.memo) : ""}</small></span>`
        + `<span class="a">${yen(i.amount)}${i.refund ? `<small>補填 −${yen(i.refund)}</small>` : ""}</span>`;
      li.onclick = () => edit(i.id);
      ul.appendChild(li);
    });
  }
  $("prevMonth").onclick = () => { viewMonth = shiftMonth(viewMonth, -1); renderList(); };
  $("nextMonth").onclick = () => { viewMonth = shiftMonth(viewMonth, 1); renderList(); };

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

  // ---- 書き出し画面
  let template = null;
  async function loadTemplate() {
    if (template) return template;
    const res = await fetch("form/iryouhi_form_v3.1.xlsx");
    if (!res.ok) throw new Error("フォームの原本を読めませんでした");
    template = new Uint8Array(await res.arrayBuffer());
    return template;
  }
  function renderMore() {
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
    $("formPreview").innerHTML = rows.length
      ? `${y}年分：${rows.length}行、医療費 ${yen(s.total)}${s.refund ? `、補填 ${yen(s.refund)}` : ""}<small>国税庁の様式 Ver.3.1。読み込み後は作成コーナーの画面で内容を確かめてください。</small>`
      : `${y}年分の記録はありません`;
    $("exportForm").disabled = !rows.length;
  }
  $("formYear").onchange = renderFormPreview; $("formMode").onchange = renderFormPreview;
  function renderBuy() {
    $("buyBox").hidden = purchased;
    $("exportForm").hidden = !purchased;
  }
  async function checkPurchased() {
    try {
      if (!store()) { purchased = !native; return; }   // ブラウザ確認では購入済みとして動かす
      const r = await store().isPurchased({ productId: PRODUCT_ID });
      purchased = !!r.purchased;
      if (!purchased) {
        const p = await store().getProduct({ productId: PRODUCT_ID });
        if (p && p.price) $("buyBtn").textContent = `${p.price} で購入して書き出せるようにする`;
      }
    } catch (e) { purchased = false; }
    renderBuy();
  }
  $("buyBtn").onclick = async () => {
    if (!store()) { toast("この環境では購入できません"); return; }
    $("buyBtn").disabled = true;
    try {
      const r = await store().purchase({ productId: PRODUCT_ID });
      if (r.state === "purchased") { purchased = true; toast("ありがとうございます。書き出せるようになりました"); }
      else if (r.state === "pending") toast("承認待ちです。承認されると書き出せるようになります");
    } catch (e) { toast("購入できませんでした"); }
    $("buyBtn").disabled = false; renderBuy();
  };
  $("restoreBtn").onclick = async () => {
    if (!store()) return;
    try { const r = await store().restore({ productId: PRODUCT_ID }); purchased = !!r.purchased; toast(purchased ? "購入を復元しました" : "この Apple アカウントでの購入は見つかりませんでした"); }
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
      if (await shareFile(bytes, `iryouhi_form_${y}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) toast(`${rows.length}行を書き出しました`);
    } catch (e) { toast(e.message || "書き出せませんでした"); }
  };
  $("exportCsv").onclick = async () => {
    const y = +$("formYear").value;
    if (!data.records.some(r => r.date.startsWith(String(y)))) { toast("書き出す記録がありません"); return; }
    try { if (await shareFile(csv(data.records, y), `iryouhi_${y}.csv`, "text/csv")) toast("CSVを書き出しました"); }
    catch (e) { toast("書き出せませんでした"); }
  };

  // ---- 設定
  function renderPeople() {
    const ul = $("peopleList"); ul.innerHTML = "";
    if (!data.people.length) { ul.innerHTML = '<li class="empty">まだ登録がありません。本人と家族の名前を追加してください</li>'; return; }
    data.people.forEach(p => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="t">${esc(p)}</span><button type="button" aria-label="${esc(p)}を削除">削除</button>`;
      li.querySelector("button").onclick = async () => {
        const used = data.records.filter(r => r.person === p).length;
        if (!confirm(used ? `${p} を一覧から外しますか？ 記録 ${used}件はそのまま残ります。` : `${p} を削除しますか？`)) return;
        data.people = data.people.filter(x => x !== p);
        if (state.person === p) state.person = data.people[0] || "";
        await save(); renderPeople();
      };
      ul.appendChild(li);
    });
  }
  $("addPerson").onclick = async () => {
    const name = $("newPerson").value.trim().slice(0, 10);
    if (!name) return;
    if (!data.people.includes(name)) data.people.push(name);
    if (!state.person) state.person = name;
    $("newPerson").value = "";
    await save(); renderPeople();
  };
  $("income").onchange = async () => { const v = Math.max(0, Math.round(Number($("income").value) || 0)); data.settings.income = v || ""; $("income").value = v || ""; await save(); };

  // ---- バックアップ
  $("backupBtn").onclick = async () => {
    try { if (await shareFile(backup(data), `iryouhi-memo_backup_${today().replace(/-/g, "")}.json`, "application/json")) toast("バックアップを書き出しました"); }
    catch (e) { toast("書き出せませんでした"); }
  };
  $("restoreFile").onchange = async e => {
    const file = e.target.files[0]; e.target.value = ""; if (!file) return;
    try {
      const d = restore(await file.text());
      const mode = data.records.length ? confirm(`今の記録 ${data.records.length}件に、バックアップの ${d.records.length}件を追加しますか？\n（「キャンセル」で今の記録を置き換えます）`) : false;
      if (mode) {
        const have = new Set(data.records.map(r => [r.date, r.person, r.place, r.amount].join("|")));
        d.records.forEach(r => { if (!have.has([r.date, r.person, r.place, r.amount].join("|"))) data.records.push(r); });
        d.people.forEach(p => { if (!data.people.includes(p)) data.people.push(p); });
      } else {
        if (data.records.length && !confirm(`今の記録 ${data.records.length}件を消して、バックアップの ${d.records.length}件に置き換えます。よいですか？`)) return;
        data.records = d.records; data.people = d.people; data.settings = Object.assign(data.settings, d.settings);
      }
      state.person = data.people[0] || "";
      await save(); renderMore(); toast(`読み込みました（記録 ${data.records.length}件）`);
    } catch (err) { toast(err.message || "読み込めませんでした"); }
  };

  // ---- レシートの読み取り（iPhoneの標準機能で、この端末の中で読む）
  function ocrNote(text, preview) {
    $("ocrBox").hidden = false;
    $("ocrNote").textContent = text;
    $("ocrImg").setAttribute("src", preview ? "data:image/jpeg;base64," + preview : "");
  }
  async function readReceipt(method) {
    if (!scanner()) { toast("この環境では読み取れません"); return; }
    let res;
    try { res = await scanner()[method](); }
    catch (e) { ocrNote(e.message || "読み取れませんでした"); return; }
    if (res.cancelled) return;
    if (res.unsupported) { toast("この端末ではカメラを使えません。写真から読んでください"); return; }
    const r = parseReceipt(groupLines(res.items || []));
    if (r.date) $("date").value = r.date;
    if (r.amount) $("amount").value = r.amount;
    if (r.place) { $("place").value = r.place; const known = placeOptions().get(r.place); if (known) r.kind = known; }
    state.kind = r.kind; state.mixed = r.mixed;
    renderForm();
    const got = [r.date && "日付", r.amount && "金額", r.place && "名称"].filter(Boolean);
    ocrNote(got.length
      ? `${got.join("・")}を読み取りました。医療を受けた人を選び、違っていたら直して「記録する」を押してください。` + (r.amount ? "" : "金額（領収金額・負担額）は読み取れなかったので入れてください。")
      : "読み取れませんでした。明るい場所で撮り直すか、手で入力してください。", res.preview);
  }
  $("scanBtn").onclick = () => readReceipt("scanReceipt");
  $("pickBtn").onclick = () => readReceipt("pickPhoto");

  // ---- このアプリについて（標準のブラウザで開く）
  $("privacyBtn").onclick = () => window.open(PRIVACY_URL, "_blank");
  $("supportBtn").onclick = () => window.open(SUPPORT_URL, "_blank");

  $("date").value = today();
  renderForm();
  checkPurchased();
  const first = location.hash.slice(1);
  showTab(TITLES[first] ? first : "home");
})();
