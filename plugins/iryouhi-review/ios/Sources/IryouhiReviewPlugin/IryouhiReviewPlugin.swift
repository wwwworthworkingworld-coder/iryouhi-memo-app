import Foundation
import Capacitor
import StoreKit

/// App Store のレビュー依頼。Apple の標準ダイアログを「出してよいか」を頼むだけで、出すかどうか・年 3 回までの制限は Apple が決める。
/// こちらで評価を誘導する文言や「あとで」などのボタンは出さない（審査ガイドライン 1.1.7／5.6.1）。
@objc(IryouhiReviewPlugin)
public class IryouhiReviewPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IryouhiReviewPlugin"
    public let jsName = "IryouhiReview"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise)
    ]

    @objc func request(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else {
                call.resolve(["requested": false])
                return
            }
            if #available(iOS 16.0, *) {
                AppStore.requestReview(in: scene)
            } else {
                SKStoreReviewController.requestReview(in: scene)
            }
            call.resolve(["requested": true])
        }
    }
}
