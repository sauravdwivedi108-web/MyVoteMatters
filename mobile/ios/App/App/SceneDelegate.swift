import UIKit
import WebKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Makes the web app's Print and file-download buttons work in the app:
/// WKWebView ignores window.print() and blob: downloads, so the injected
/// shim (mobile/native/mvm-shim.js) forwards them here.
class MainViewController: CAPBridgeViewController, WKScriptMessageHandler {
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.userContentController.addUserScript(
            WKUserScript(source: MainViewController.shim, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        configuration.userContentController.add(WeakScriptMessageHandler(self), name: "mvm")
        return configuration
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        if type == "print" {
            guard let webView = webView else { return }
            let printController = UIPrintInteractionController.shared
            printController.printFormatter = webView.viewPrintFormatter()
            printController.present(animated: true)
        } else if type == "save",
                  let name = body["name"] as? String,
                  let base64 = body["base64"] as? String,
                  let data = Data(base64Encoded: base64) {
            let safeName = name.replacingOccurrences(of: "[^A-Za-z0-9._-]", with: "_", options: .regularExpression)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
            do { try data.write(to: url) } catch { return }
            let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            share.popoverPresentationController?.sourceView = view
            share.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
            present(share, animated: true)
        }
    }

    private static let shim = #"""
// Makes the web app's Print and file-download buttons work inside the
// mobile app, where WebViews ignore window.print() and blob: downloads.
// Injected by the native shell (Android MainActivity, iOS MainViewController).
(function () {
  if (window.__mvmShim) return;
  window.__mvmShim = true;

  function send(msg) {
    if (window.MVMNative) {
      if (msg.type === 'print') window.MVMNative.print();
      else window.MVMNative.saveFile(msg.name, msg.mime, msg.base64);
    } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mvm) {
      window.webkit.messageHandlers.mvm.postMessage(msg);
    }
  }

  window.print = function () { send({ type: 'print' }); };

  // The app revokes blob URLs right after clicking the link, so keep the blob.
  var blobs = {};
  var create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = function (obj) {
    var url = create.call(URL, obj);
    if (obj instanceof Blob) blobs[url] = obj;
    return url;
  };
  URL.revokeObjectURL = function (url) {
    setTimeout(function () { delete blobs[url]; revoke.call(URL, url); }, 60000);
  };

  function save(a) {
    var blob = blobs[a.href];
    if (!blob) return false;
    var reader = new FileReader();
    reader.onload = function () {
      var data = String(reader.result);
      send({ type: 'save', name: a.download || 'download', mime: blob.type || 'application/octet-stream', base64: data.slice(data.indexOf(',') + 1) });
    };
    reader.readAsDataURL(blob);
    return true;
  }

  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download') && this.href.indexOf('blob:') === 0 && save(this)) return;
    return click.call(this);
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[download]');
    if (a && a.href.indexOf('blob:') === 0 && save(a)) e.preventDefault();
  }, true);
})();
"""#
}

/// Avoids a retain cycle between WKUserContentController and the view controller.
private class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
