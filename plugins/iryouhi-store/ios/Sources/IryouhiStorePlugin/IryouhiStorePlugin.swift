import Foundation
import Capacitor
import StoreKit

/// アプリ内課金（買い切り・非消耗型）。StoreKit 2 だけを使い、サーバーも外部サービスも使わない。
/// 購入の有無は Apple の Transaction.currentEntitlements で確かめる（端末を変えても同じ Apple アカウントなら復元できる）
@objc(IryouhiStorePlugin)
public class IryouhiStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IryouhiStorePlugin"
    public let jsName = "IryouhiStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProduct", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isPurchased", returnType: CAPPluginReturnPromise)
    ]
    private var updates: Task<Void, Never>?

    public override func load() {
        // アプリの外で完了した取引（承認待ちが承認された等）を受け取って finish する
        updates = Task.detached { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let t) = result {
                    await t.finish()
                    self?.notifyListeners("purchaseUpdated", data: ["productId": t.productID])
                }
            }
        }
    }

    deinit { updates?.cancel() }

    private func owns(_ productId: String) async -> Bool {
        for await result in Transaction.currentEntitlements {
            if case .verified(let t) = result, t.productID == productId, t.revocationDate == nil {
                return true
            }
        }
        return false
    }

    @objc func isPurchased(_ call: CAPPluginCall) {
        let id = call.getString("productId") ?? ""
        Task {
            let ok = await owns(id)
            call.resolve(["purchased": ok])
        }
    }

    @objc func getProduct(_ call: CAPPluginCall) {
        let id = call.getString("productId") ?? ""
        Task {
            do {
                guard let p = try await Product.products(for: [id]).first else {
                    call.reject("商品が見つかりません")
                    return
                }
                call.resolve(["productId": p.id, "price": p.displayPrice, "name": p.displayName, "description": p.description])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        let id = call.getString("productId") ?? ""
        Task {
            do {
                guard let p = try await Product.products(for: [id]).first else {
                    call.reject("商品が見つかりません")
                    return
                }
                let result = try await p.purchase()
                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let t):
                        await t.finish()
                        call.resolve(["state": "purchased"])
                    case .unverified:
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

    @objc func restore(_ call: CAPPluginCall) {
        let id = call.getString("productId") ?? ""
        Task {
            try? await AppStore.sync()
            let ok = await owns(id)
            call.resolve(["purchased": ok])
        }
    }
}
