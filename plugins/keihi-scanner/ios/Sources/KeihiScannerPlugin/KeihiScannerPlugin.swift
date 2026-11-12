import Foundation
import UIKit
import Capacitor
import VisionKit
import PhotosUI

@objc(KeihiScannerPlugin)
public class KeihiScannerPlugin: CAPPlugin, CAPBridgedPlugin, VNDocumentCameraViewControllerDelegate, PHPickerViewControllerDelegate {
    public let identifier = "KeihiScannerPlugin"
    public let jsName = "KeihiScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scanReceipt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickPhoto", returnType: CAPPluginReturnPromise)
    ]
    private var pending: CAPPluginCall?

    @objc func scanReceipt(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard VNDocumentCameraViewController.isSupported else {
                call.resolve(["unsupported": true])
                return
            }
            self.pending = call
            let vc = VNDocumentCameraViewController()
            vc.delegate = self
            self.bridge?.viewController?.present(vc, animated: true)
        }
    }

    @objc func pickPhoto(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.pending = call
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
        finish(image)
    }

    public func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
        finish(nil)
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        controller.dismiss(animated: true)
        pending?.reject(error.localizedDescription)
        pending = nil
    }

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else {
            finish(nil)
            return
        }
        provider.loadObject(ofClass: UIImage.self) { [weak self] object, _ in
            self?.finish(object as? UIImage)
        }
    }

    // 読み取った文字と小さな確認用の画像だけを返す。写真は保存しない
    private func finish(_ image: UIImage?) {
        guard let call = pending else { return }
        pending = nil
        guard let image = image else {
            call.resolve(["cancelled": true])
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let upright = Self.redraw(image, maxSide: 3000)
                guard let cg = upright.cgImage else {
                    call.reject("画像を読み込めませんでした")
                    return
                }
                let items = try KeihiOCR.recognize(cg).map { i -> [String: Any] in
                    ["text": i.text, "x": i.x, "y": i.y, "w": i.w, "h": i.h]
                }
                let preview = Self.redraw(image, maxSide: 480).jpegData(compressionQuality: 0.7)?.base64EncodedString() ?? ""
                call.resolve(["items": items, "preview": preview])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    // 向きをそろえ、大きすぎる画像を縮める
    private static func redraw(_ image: UIImage, maxSide: CGFloat) -> UIImage {
        let k = min(1, maxSide / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * k, height: image.size.height * k)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }
}
