import Foundation
import CoreGraphics
import Vision

/// 病院・薬局の領収書を、端末の中で読む（通信しない）。
/// 1) Vision で文字を読む 2) 医療の領収書向けに「領収金額・一部負担金」「受診者（〇〇 様）」「令和の日付」「施設名」の候補を出す。
/// 保険点数（「142点」）を金額と間違えないのがいちばん大事な仕事。
public enum MedicalReceiptReader {
    public struct Item {
        public let text: String
        public let x, y, w, h: Double  // 画像全体を1とした位置（原点は左下）
    }

    public struct Guess {
        public var amount: Int = 0
        public var date: String = ""      // yyyy-MM-dd
        public var patient: String = ""
        public var place: String = ""
        public var points: Int = 0        // 読めた保険点数（参考。金額ではない）
        public var dict: [String: Any] {
            var d: [String: Any] = [:]
            if amount > 0 { d["amount"] = amount }
            if !date.isEmpty { d["date"] = date }
            if !patient.isEmpty { d["patient"] = patient }
            if !place.isEmpty { d["place"] = place }
            if points > 0 { d["points"] = points }
            return d
        }
    }

    public static func recognize(_ image: CGImage) throws -> [Item] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        if #available(iOS 16.0, macOS 13.0, *) {
            request.revision = VNRecognizeTextRequestRevision3
        }
        request.recognitionLanguages = ["ja-JP", "en-US"]
        request.usesLanguageCorrection = true
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        return (request.results ?? []).compactMap { obs in
            guard let top = obs.topCandidates(1).first else { return nil }
            let b = obs.boundingBox
            return Item(text: top.string, x: Double(b.minX), y: Double(b.minY), w: Double(b.width), h: Double(b.height))
        }
    }

    // ---- 行にまとめる（「領収金額」と「¥1,230」が別のかたまりになるため）
    public static func lines(_ items: [Item]) -> [String] {
        struct Row { var cy: Double; var h: Double; var items: [Item] }
        var rows: [Row] = []
        for i in items where !i.text.trimmingCharacters(in: .whitespaces).isEmpty {
            let cy = i.y + i.h / 2
            if let idx = rows.firstIndex(where: { abs($0.cy - cy) < min($0.h, i.h) * 0.6 }) {
                rows[idx].items.append(i)
                rows[idx].cy = rows[idx].items.map { $0.y + $0.h / 2 }.reduce(0, +) / Double(rows[idx].items.count)
            } else {
                rows.append(Row(cy: cy, h: i.h, items: [i]))
            }
        }
        return rows.sorted { $0.cy > $1.cy }.map { r in
            r.items.sorted { $0.x < $1.x }.map { $0.text.trimmingCharacters(in: .whitespaces) }.joined(separator: " ")
        }
    }

    // ---- 候補を出す
    public static func guess(_ items: [Item], now: Date = Date()) -> Guess {
        var g = Guess()
        let raw = lines(items).map(normalize)
        let tight = raw.map { $0.replacingOccurrences(of: " ", with: "") }
        g.date = findDate(raw + tight, now: now)
        (g.amount, g.points) = findAmount(tight)
        g.patient = findPatient(raw)
        g.place = findPlace(tight)
        return g
    }

    private static func normalize(_ s: String) -> String {
        var t = s.applyingTransform(.fullwidthToHalfwidth, reverse: false) ?? s
        t = t.replacingOccurrences(of: "￥", with: "¥").replacingOccurrences(of: "，", with: ",")
        return t.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
    }

    private static func match(_ s: String, _ pattern: String) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: pattern), let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (0..<m.numberOfRanges).map { i in
            guard let r = Range(m.range(at: i), in: s) else { return "" }
            return String(s[r])
        }
    }

    private static func findDate(_ lines: [String], now: Date) -> String {
        let cal = Calendar(identifier: .gregorian)
        func ok(_ y: Int, _ m: Int, _ d: Int) -> String? {
            guard (1...12).contains(m), (1...31).contains(d), let t = cal.date(from: DateComponents(year: y, month: m, day: d)) else { return nil }
            let diff = now.timeIntervalSince(t) / 86400
            guard diff > -2, diff < 400, cal.component(.month, from: t) == m else { return nil }
            return String(format: "%04d-%02d-%02d", y, m, d)
        }
        for l in lines {
            if let m = match(l, "(20\\d\\d) ?[年/\\-.] ?(\\d{1,2}) ?[月/\\-.] ?(\\d{1,2})(?!\\d)"), let s = ok(Int(m[1])!, Int(m[2])!, Int(m[3])!) { return s }
            if let m = match(l, "(?:令和|R\\.?|令) ?(\\d{1,2}) ?[年/.] ?(\\d{1,2}) ?[月/.] ?(\\d{1,2})(?!\\d)"), let s = ok(2018 + Int(m[1])!, Int(m[2])!, Int(m[3])!) { return s }
            if let m = match(l, "(?:^|[^\\d])(\\d\\d)[/.](\\d{1,2})[/.](\\d{1,2})(?!\\d)"), let s = ok(2000 + Int(m[1])!, Int(m[2])!, Int(m[3])!) { return s }
        }
        return ""
    }

    // 病院・薬局の領収書に多い言い方を優先。点数・割合・回数・小計・預り・釣りは金額ではない
    private static let levels = ["領収金額|領収額|御領収額|ご領収金額|領収済額", "請求金額|ご請求額|請求額|お支払金額|お支払額|お支払い金額|支払金額|負担額|一部負担金|患者負担額|患者負担", "合計|総計|総額|税込計", "計"]
    private static let notAmount = "小計|預|釣|対象|消費税|内税|税額|税率|点数|保険点|点|単位|回数|日数|割合|負担割|割(?![引])|%|％|個|ポイント|pt|割引|値引|クーポン|現金|カード|クレジット|電子マネー|QR|PayPay|番号|No"

    private static func numbers(_ s: String) -> [Int] {
        var t = s.replacingOccurrences(of: "T\\d{13}", with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: "\\d{2,4}-\\d{2,4}-\\d{3,4}", with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: "(20\\d\\d|令和\\d{1,2}|R\\d{1,2})[年/\\-.]\\d{1,2}[月/\\-.]\\d{1,2}日?", with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: "\\d{1,2}:\\d{2}", with: "", options: .regularExpression)
        guard let re = try? NSRegularExpression(pattern: "¥?\\d{1,3}(?:[,.]\\d{3})+|¥?\\d+") else { return [] }
        return re.matches(in: t, range: NSRange(t.startIndex..., in: t)).compactMap { m in
            guard let r = Range(m.range, in: t) else { return nil }
            let v = Int(t[r].replacingOccurrences(of: "[¥,.]", with: "", options: .regularExpression)) ?? 0
            return v > 0 && v < 10_000_000 ? v : nil
        }
    }

    private static func findAmount(_ lines: [String]) -> (Int, Int) {
        var points = 0
        for l in lines {
            if let m = match(l, "(?:合計点数|総点数|点数)[^\\d]{0,6}(\\d{1,6})点?"), let p = Int(m[1]) { points = p; break }
            if let m = match(l, "(\\d{1,6})点$"), let p = Int(m[1]) { points = max(points, p) }
        }
        var amount = 0
        outer: for level in levels {
            for (i, l) in lines.enumerated() {
                guard let m = match(l, level), let r = l.range(of: m[0]) else { continue }
                let head = String(l[..<r.upperBound]), rest = String(l[r.upperBound...])
                if head.range(of: "小計|保険点|点数|単位", options: .regularExpression) != nil { continue }
                var cut = rest
                if let nr = rest.range(of: notAmount, options: .regularExpression) { cut = String(rest[..<nr.lowerBound]) }
                if cut != rest && cut.range(of: "\\d", options: .regularExpression) == nil { continue }
                var v = numbers(cut)
                if v.isEmpty && cut == rest && i + 1 < lines.count { v = numbers(lines[i + 1]) }
                if let mx = v.max() { amount = mx; break outer }
            }
        }
        if amount == 0 {
            let v = lines.filter { ($0.contains("¥") || $0.contains("円")) && $0.range(of: "預|釣|点", options: .regularExpression) == nil }.flatMap(numbers)
            amount = v.max() ?? 0
        }
        return (amount, points)
    }

    private static func findPatient(_ lines: [String]) -> String {
        for l in lines.prefix(12) {
            let m = match(l, "^(?:患者(?:氏名|名|様)?|氏名|お名前|名前)[:：]? ?(.{1,12}?) ?(?:様|殿)?$") ?? match(l, "^(.{1,12}?) ?(?:様|殿)$")
            guard let name = m?[1].trimmingCharacters(in: .whitespaces), !name.isEmpty else { continue }
            if name.range(of: "[ぁ-んァ-ヶ一-龠]", options: .regularExpression) == nil { continue }
            if name.range(of: "領収|明細|保険|病院|薬局|医院|クリニック|患者", options: .regularExpression) != nil { continue }
            return name
        }
        return ""
    }

    private static let placeWords = "病院|クリニック|医院|歯科|診療所|薬局|調剤|ドラッグ|薬店|医療|療院|接骨|整骨|鍼灸|はりきゅう|眼科|内科|外科|小児科|皮膚科|耳鼻|産婦人科|整形|心療|メンタル|センター|介護|デイサービス|タクシー"
    private static let skipWords = "領収|レシート|明細|計|請求|金額|毎度|ありがと|いらっしゃ|電話|TEL|FAX|〒|登録番号|都|道|府|県|市|区|町|丁目|番地|\\d{2,}|様|殿|患者|氏名|保険|診療日|発行"

    private static func findPlace(_ lines: [String]) -> String {
        let head = Array(lines.prefix(8))
        let found = head.first { $0.range(of: placeWords, options: .regularExpression) != nil && $0.range(of: "領収|明細|患者|様", options: .regularExpression) == nil }
            ?? head.first { $0.range(of: "[ぁ-んァ-ヶ一-龠]{2,}", options: .regularExpression) != nil && $0.range(of: skipWords, options: [.regularExpression, .caseInsensitive]) == nil }
        guard var p = found else { return "" }
        p = p.replacingOccurrences(of: "^(医療法人|社会医療法人|医療法人社団|医療法人財団|一般財団法人|社会福祉法人|株式会社|有限会社)", with: "", options: .regularExpression)
        return String(p.prefix(20))
    }
}
