import Foundation
import CoreGraphics
import Vision

/// 画像の中の文字を、端末の中で読み取る（通信しない）
public enum KeihiOCR {
    public struct Item {
        public let text: String
        public let x, y, w, h: Double  // 画像全体を1とした位置（原点は左下）
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
}
