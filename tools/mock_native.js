// ストア画像を撮るときだけ（ios-screens.yml）シミュレーターのアプリに差し込む。架空のデータを入れて、画面を順に切り替える
(async () => {
  const pad = n => String(n).padStart(2, "0");
  const d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1;
  const R = (mm, dd, person, place, kind, amount, refund = 0, memo = "") => ({ id: "demo" + mm + dd + amount, date: `${y}-${pad(mm)}-${pad(dd)}`, person, place, kind, amount, refund, memo });
  const rows = [
    R(m, Math.min(d.getDate(), 28), "見本 太郎", "みどり内科クリニック", "care", 1230, 0, "定期受診"),
    R(m, Math.min(d.getDate(), 28), "見本 太郎", "さくら薬局", "drug", 3210),
    R(m, Math.min(d.getDate(), 28), "見本 太郎", "電車・バス", "other", 420, 0, "通院の交通費"),
    R(Math.max(1, m - 1), 14, "見本 花子", "ひまわり歯科", "care", 38500, 0, "治療"),
    R(Math.max(1, m - 1), 9, "見本 はな", "こども小児科", "care", 600),
    R(Math.max(1, m - 1), 9, "見本 はな", "さくら薬局", "drug", 1100),
    R(Math.max(1, m - 2), 21, "見本 花子", "ひまわり歯科", "care", 86000, 20000, "保険金あり"),
    Object.assign(R(Math.max(1, m - 2), 3, "見本 太郎", "サンプルドラッグ", "drug", 1280, 0, "かぜ薬"), { otc: true }),
    Object.assign(R(Math.max(1, m - 1), 22, "見本 花子", "サンプルドラッグ", "drug", 2980, 0, "胃腸薬"), { otc: true }),
    R(Math.max(1, m - 3), 18, "見本 太郎", "みどり内科クリニック", "care", 2660),
    R(Math.max(1, m - 3), 18, "見本 太郎", "さくら薬局", "drug", 2980),
  ];
  const P = window.Capacitor.Plugins;
  const seeded = await P.Preferences.get({ key: "seeded" });
  if (!seeded.value) {
    await P.Preferences.set({ key: "seeded", value: "1" });
    await P.Preferences.set({ key: "iryouhi-memo-v1", value: JSON.stringify({ records: rows, people: ["見本 太郎", "見本 花子", "見本 はな"], settings: { income: "", rate: 0.10 } }) });
    location.reload();
    return;
  }
  const receipt = {
    items: [
      { text: "医療法人 みどり内科クリニック", x: 0.1, y: 0.92, w: 0.6, h: 0.04 }, { text: "領収書", x: 0.4, y: 0.86, w: 0.2, h: 0.04 },
      { text: `${y}年${m}月${d.getDate()}日`, x: 0.1, y: 0.74, w: 0.5, h: 0.04 },
      { text: "合計点数", x: 0.1, y: 0.62, w: 0.3, h: 0.04 }, { text: "410点", x: 0.7, y: 0.62, w: 0.2, h: 0.04 },
      { text: "領収金額", x: 0.1, y: 0.48, w: 0.3, h: 0.04 }, { text: "¥1,230", x: 0.7, y: 0.48, w: 0.2, h: 0.04 },
    ],
    preview: window.__receiptPreview || "",
  };
  window.IryouhiMock = { scanReceipt: async () => receipt, pickPhoto: async () => receipt };
  window.IryouhiStoreMock = { isPurchased: async () => ({ purchased: true }), getProduct: async () => ({ price: "¥600" }), purchase: async () => ({ state: "purchased" }), restore: async () => ({ purchased: true }) };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // 1画面を60秒ずつ見せる。ios-screens.yml が起動の40秒後から60秒おきに撮る
  await wait(60000); document.querySelector("[data-tab=add]").click(); document.getElementById("scanBtn").click();
  await wait(60000); document.querySelector("[data-tab=list]").click();
  await wait(60000); document.querySelector("[data-tab=more]").click();
})();
