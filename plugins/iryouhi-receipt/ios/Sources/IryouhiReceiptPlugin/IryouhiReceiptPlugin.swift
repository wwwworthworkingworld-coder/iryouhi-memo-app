import Foundation
import UIKit
import Capacitor
import VisionKit
import PhotosUI

/// 領収書の撮影・写真の選択と、端末の中での読み取り（医療費控除メモ専用）。
/// 読み取った文字と候補（金額・日付・受診者・施設名）と小さな確認用画像だけを返し、写真は保存しない
@objc(IryouhiReceiptPlugin)
public class IryouhiReceiptPlugin: CAPPlugin, CAPBridgedPlugin, VNDocumentCameraViewControllerDelegate, PHPickerViewControllerDelegate {
    public let identifier = "IryouhiReceiptPlugin"
    public let jsName = "IryouhiReceipt"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "captureReceipt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFromLibrary", returnType: CAPPluginReturnPromise)
    ]
    private var waiting: CAPPluginCall?

    /// 標準の書類スキャナで撮る
    @objc func captureReceipt(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard VNDocumentCameraViewController.isSupported else {
                call.resolve(["unsupported": true])
                return
            }
            self.waiting = call
            let vc = VNDocumentCameraViewController()
            vc.delegate = self
            self.bridge?.viewController?.present(vc, animated: true)
        }
    }

    /// 写真ライブラリから 1 枚選ぶ（アプリは写真全体へのアクセス権を持たない）
    @objc func readFromLibrary(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.waiting = call
            var config = PHPickerConfiguration()
            config.filter = .images
            config.selectionLimit = 1
            let vc = PHPickerViewController(configuration: config)
            vc.delegate = self
            self.bridge?.viewController?.present(vc, animated: true)
        }
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        let image = scan.pageCount > 0 ? scan.imageOfPage(at: 0) : nil
        controller.dismiss(animated: true)
        deliver(image)
    }

    public func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
        deliver(nil)
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        controller.dismiss(animated: true)
        waiting?.reject(error.localizedDescription)
        waiting = nil
    }

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else {
            deliver(nil)
            return
        }
        provider.loadObject(ofClass: UIImage.self) { [weak self] object, _ in
            self?.deliver(object as? UIImage)
        }
    }

    private func deliver(_ image: UIImage?) {
        guard let call = waiting else { return }
        waiting = nil
        guard let image = image else {
            call.resolve(["cancelled": true])
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let upright = Self.fit(image, maxSide: 3000)
                guard let cg = upright.cgImage else {
                    call.reject("画像を読み込めませんでした")
                    return
                }
                let items = try MedicalReceiptReader.recognize(cg)
                let guess = MedicalReceiptReader.guess(items)
                let thumb = Self.fit(image, maxSide: 480).jpegData(compressionQuality: 0.7)?.base64EncodedString() ?? ""
                call.resolve([
                    "items": items.map { ["text": $0.text, "x": $0.x, "y": $0.y, "w": $0.w, "h": $0.h] },
                    "guess": guess.dict,
                    "preview": thumb
                ])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    // 向きをそろえ、大きすぎる画像を縮める
    private static func fit(_ image: UIImage, maxSide: CGFloat) -> UIImage {
        let k = min(1, maxSide / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * k, height: image.size.height * k)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }
}
