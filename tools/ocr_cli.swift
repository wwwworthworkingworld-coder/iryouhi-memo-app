// CIのMacで、アプリと同じ読み取り処理（KeihiOCR.swift）を画像にかけ、結果をJSONで出す
import Foundation
import CoreGraphics
import ImageIO

@main
struct Main {
    static func main() throws {
        var out: [String: [[String: Any]]] = [:]
        for path in CommandLine.arguments.dropFirst() {
            let url = URL(fileURLWithPath: path)
            guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
                fatalError("画像を読めません: \(path)")
            }
            out[url.deletingPathExtension().lastPathComponent] = try KeihiOCR.recognize(img).map {
                ["text": $0.text, "x": $0.x, "y": $0.y, "w": $0.w, "h": $0.h]
            }
        }
        let data = try JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
        FileHandle.standardOutput.write(data)
    }
}
