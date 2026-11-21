import Foundation
import Capacitor
import StoreKit

/// 「集計フォームの書き出し」の買い切り（非消耗型・StoreKit 2）と、App Store のレビュー依頼。
/// 商品は 1 つだけなので ID はここに固定する。サーバーも外部サービスも使わず、所有は Apple の Transaction.currentEntitlements で確かめる
@objc(IryouhiFormPlugin)
public class IryouhiFormPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IryouhiFormPlugin"
    public let jsName = "IryouhiForm"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "offer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "askReview", returnType: CAPPluginReturnPromise)
    ]
    static let productID = "com.company256.iryouhi.form"
    private var watcher: Task<Void, Never>?

    public override func load() {
        // アプリの外で完了した取引（承認待ちが承認された等）を受け取って finish する
        watcher = Task.detached { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let t) = result {
                    await t.finish()
                    self?.notifyListeners("formUnlocked", data: ["productId": t.productID])
                }
            }
        }
    }

    deinit { watcher?.cancel() }

    private func owned() async -> Bool {
        for await result in Transaction.currentEntitlements {
            if case .verified(let t) = result, t.productID == Self.productID, t.revocationDate == nil {
                return true
            }
        }
        return false
    }

    /// 持っているか
    @objc func status(_ call: CAPPluginCall) {
        Task { call.resolve(["owned": await owned()]) }
    }

    /// 価格と表示名（未登録・取得できないときはエラーにせず found:false）
    @objc func offer(_ call: CAPPluginCall) {
        Task {
            do {
                guard let p = try await Product.products(for: [Self.productID]).first else {
                    call.resolve(["found": false])
                    return
                }
                call.resolve(["found": true, "price": p.displayPrice, "name": p.displayName, "description": p.description])
            } catch {
                call.resolve(["found": false, "error": error.localizedDescription])
            }
        }
    }

    /// 購入
    @objc func unlock(_ call: CAPPluginCall) {
        Task {
            do {
                guard let p = try await Product.products(for: [Self.productID]).first else {
                    call.reject("商品が見つかりません")
                    return
                }
                switch try await p.purchase() {
                case .success(let verification):
                    if case .verified(let t) = verification {
                        await t.finish()
                        call.resolve(["state": "purchased"])
                    } else {
                        call.reject("購入を確認できませんでした")
                    }
                case .pending:
                    call.resolve(["state": "pending"])
                case .userCancelled:
                    call.resolve(["state": "cancelled"])
                @unknown default:
                    call.resolve(["state": "cancelled"])
                }
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    /// 復元（同じ Apple アカウントの購入を確かめ直す）
    @objc func recover(_ call: CAPPluginCall) {
        Task {
            try? await AppStore.sync()
            call.resolve(["owned": await owned()])
        }
    }

    /// レビュー依頼。Apple の標準ダイアログを「出してよいか」を頼むだけで、出すかどうかは Apple が決める（1.1.7／5.6.1）
    @objc func askReview(_ call: CAPPluginCall) {
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
