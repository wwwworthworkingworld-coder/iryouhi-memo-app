// パソコンのブラウザで画面を確かめるとき（tools/serve_test.py）だけ読み込む。アプリには入らない
(() => {
  const q = new URLSearchParams(location.search);
  const pad = n => String(n).padStart(2, "0");
  if (q.get("seed") !== null && !sessionStorage.getItem("seeded")) {
    sessionStorage.setItem("seeded", "1");
    const d = new Date(), y = d.getFullYear();
    const m = d.getMonth() + 1;
    const R = (mm, dd, person, place, kind, amount, refund = 0, memo = "") => ({ id: "demo" + Math.random().toString(36).slice(2, 7), date: `${y}-${pad(mm)}-${pad(dd)}`, person, place, kind, amount, refund, memo });
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
      { id: "demo_last", date: `${y - 1}-12-20`, person: "見本 太郎", place: "みどり内科クリニック", kind: "care", amount: 4400, refund: 0, memo: "" },
    ];
    localStorage.setItem("iryouhi-memo-v1", JSON.stringify({ records: rows, people: ["見本 太郎", "見本 花子", "見本 はな"], settings: { income: "", rate: 0.10 } }));
  }
  const receipt = {
    items: [
      { text: "医療法人 みどり内科クリニック", x: 0.1, y: 0.92, w: 0.6, h: 0.04 },
      { text: "領収書", x: 0.4, y: 0.86, w: 0.2, h: 0.04 },
      { text: "見本 太郎 様", x: 0.1, y: 0.8, w: 0.4, h: 0.04 },
      { text: `${new Date().getFullYear()}年${new Date().getMonth() + 1}月${new Date().getDate()}日`, x: 0.1, y: 0.74, w: 0.5, h: 0.04 },
      { text: "合計点数", x: 0.1, y: 0.62, w: 0.3, h: 0.04 }, { text: "410点", x: 0.7, y: 0.62, w: 0.2, h: 0.04 },
      { text: "負担割合", x: 0.1, y: 0.56, w: 0.3, h: 0.04 }, { text: "3割", x: 0.7, y: 0.56, w: 0.2, h: 0.04 },
      { text: "領収金額", x: 0.1, y: 0.48, w: 0.3, h: 0.04 }, { text: "¥1,230", x: 0.7, y: 0.48, w: 0.2, h: 0.04 },
    ],
    preview: window.__receiptPreview || "",
  };
  window.IryouhiMock = { scanReceipt: async () => receipt, pickPhoto: async () => receipt };
  // 購入の試し：?buy=0 で未購入の画面
  let bought = q.get("buy") !== "0";
  window.IryouhiStoreMock = {
    isPurchased: async () => ({ purchased: bought }),
    getProduct: async () => ({ productId: "mock", price: "¥600", name: "集計フォームの書き出し" }),
    purchase: async () => { bought = true; return { state: "purchased" }; },
    restore: async () => ({ purchased: bought }),
  };
  // 撮影用：iPhoneの上下の余白をまねて、読み取り後の画面を出す
  if (q.get("shot") !== null) {
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = ".bar{padding-top:62px!important}.tabs{padding-bottom:30px!important}";
      document.head.appendChild(s);
    });
    if (q.get("scan") !== null) setTimeout(() => document.getElementById("scanBtn").click(), 400);
  }
})();
