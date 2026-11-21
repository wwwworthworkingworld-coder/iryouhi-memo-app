// CIのMacで、アプリと同じ読み取り処理（MedicalReceiptReader.swift）を画像にかけ、文字と候補をJSONで出す
import Foundation
import CoreGraphics
import ImageIO

@main
struct Main {
    static func main() throws {
        var out: [String: Any] = [:]
        for path in CommandLine.arguments.dropFirst() {
            let url = URL(fileURLWithPath: path)
            guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
                fatalError("画像を読めません: \(path)")
            }
            let items = try MedicalReceiptReader.recognize(img)
            out[url.deletingPathExtension().lastPathComponent] = items.map { ["text": $0.text, "x": $0.x, "y": $0.y, "w": $0.w, "h": $0.h] }
            out[url.deletingPathExtension().lastPathComponent + "__guess"] = MedicalReceiptReader.guess(items).dict
        }
        let data = try JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
        FileHandle.standardOutput.write(data)
    }
}
