import UIKit
import Capacitor

final class StartupDiagnosticsLogStore {
    static let shared = StartupDiagnosticsLogStore()

    private let queue = DispatchQueue(label: "xyz.chatboxapp.startup.diag.log")
    private var entries: [String] = []
    private let maxEntries = 400

    private init() {}

    func append(_ message: String) {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        let line = "[\(formatter.string(from: Date()))] \(message)"
        queue.sync {
            entries.append(line)
            if entries.count > maxEntries {
                entries.removeFirst(entries.count - maxEntries)
            }
        }
        NSLog("[StartupDiag] %@", line)
    }

    func dump() -> String {
        queue.sync {
            entries.joined(separator: "\n")
        }
    }

    func tailPreview(limit: Int) -> String {
        queue.sync {
            entries.suffix(limit).joined(separator: "\n")
        }
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private let startupDiagEnabled = true
    private var hasInstalledDebugGesture = false
    private var hasPresentedStartupDiag = false
    private var startupTimeoutWorkItem: DispatchWorkItem?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        StartupDiagnosticsLogStore.shared.append("didFinishLaunching")
        registerLifecycleObservers()
        scheduleStartupTimeoutCheck()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        StartupDiagnosticsLogStore.shared.append("applicationDidBecomeActive")
        logTopContainer()
        installManualDiagnosticsGestureIfNeeded()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        StartupDiagnosticsLogStore.shared.append("openURL: \(url.absoluteString)")
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        StartupDiagnosticsLogStore.shared.append("continueUserActivity: \(userActivity.activityType)")
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    private func registerLifecycleObservers() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleLifecycleNotification(_:)),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleLifecycleNotification(_:)),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleLifecycleNotification(_:)),
            name: UIApplication.willResignActiveNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleLifecycleNotification(_:)),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleLifecycleNotification(_:)),
            name: UIApplication.didReceiveMemoryWarningNotification,
            object: nil
        )
    }

    @objc private func handleLifecycleNotification(_ notification: Notification) {
        StartupDiagnosticsLogStore.shared.append("Notification: \(notification.name.rawValue)")
    }

    private func scheduleStartupTimeoutCheck() {
        guard startupDiagEnabled else { return }
        startupTimeoutWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            StartupDiagnosticsLogStore.shared.append("startup timeout check fired (8s)")
            self.presentDiagnosticsDialog(reason: self.localizedText(zh: "启动超过 8 秒，自动弹出诊断日志。", en: "Startup exceeded 8 seconds, showing diagnostics automatically."))
        }
        startupTimeoutWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 8.0, execute: work)
    }

    private func installManualDiagnosticsGestureIfNeeded() {
        guard startupDiagEnabled, !hasInstalledDebugGesture else { return }
        guard let rootView = window?.rootViewController?.view else { return }
        let press = UILongPressGestureRecognizer(target: self, action: #selector(handleManualDiagnosticsGesture(_:)))
        press.minimumPressDuration = 1.2
        press.numberOfTouchesRequired = 2
        rootView.addGestureRecognizer(press)
        hasInstalledDebugGesture = true
        StartupDiagnosticsLogStore.shared.append("Manual diagnostics gesture installed (2-finger long press)")
    }

    @objc private func handleManualDiagnosticsGesture(_ gesture: UILongPressGestureRecognizer) {
        if gesture.state == .began {
            StartupDiagnosticsLogStore.shared.append("Manual diagnostics gesture triggered")
            presentDiagnosticsDialog(reason: localizedText(zh: "手势触发诊断日志。", en: "Diagnostics requested by gesture."))
        }
    }

    private func logTopContainer() {
        let rootName = String(describing: type(of: window?.rootViewController))
        let topName = String(describing: type(of: topViewController(base: window?.rootViewController)))
        let tree = describeControllerTree(window?.rootViewController, depth: 0, maxDepth: 4)
        StartupDiagnosticsLogStore.shared.append("RootViewController=\(rootName), TopViewController=\(topName), ControllerTree=\(tree)")
    }

    private func describeControllerTree(_ controller: UIViewController?, depth: Int, maxDepth: Int) -> String {
        guard let controller else { return "nil" }
        if depth >= maxDepth { return "\(type(of: controller))(depth-limit)" }

        var parts: [String] = [String(describing: type(of: controller))]
        if let nav = controller as? UINavigationController, let visible = nav.visibleViewController {
            parts.append("visible=\(describeControllerTree(visible, depth: depth + 1, maxDepth: maxDepth))")
        } else if let tab = controller as? UITabBarController, let selected = tab.selectedViewController {
            parts.append("selected=\(describeControllerTree(selected, depth: depth + 1, maxDepth: maxDepth))")
        } else if let firstChild = controller.children.first {
            parts.append("child=\(describeControllerTree(firstChild, depth: depth + 1, maxDepth: maxDepth))")
        }

        if let presented = controller.presentedViewController {
            parts.append("presented=\(describeControllerTree(presented, depth: depth + 1, maxDepth: maxDepth))")
        }
        return parts.joined(separator: " -> ")
    }

    private func presentDiagnosticsDialog(reason: String) {
        guard startupDiagEnabled else { return }
        guard !hasPresentedStartupDiag else { return }
        guard let presenter = topViewController(base: window?.rootViewController) else {
            StartupDiagnosticsLogStore.shared.append("present diagnostics skipped: presenter not ready")
            return
        }

        hasPresentedStartupDiag = true
        let allLogs = StartupDiagnosticsLogStore.shared.dump()
        let preview = StartupDiagnosticsLogStore.shared.tailPreview(limit: 25)
        let message = "\(reason)\n\n\(localizedText(zh: "以下为最近日志预览（完整日志请点“复制日志”）：", en: "Recent log preview (tap \"Copy Logs\" for full output):"))\n\n\(preview)"

        let alert = UIAlertController(
            title: localizedText(zh: "启动诊断日志", en: "Startup Diagnostics"),
            message: message,
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: localizedText(zh: "复制日志", en: "Copy Logs"), style: .default, handler: { _ in
            UIPasteboard.general.string = allLogs
            StartupDiagnosticsLogStore.shared.append("diagnostics copied to pasteboard")
            self.hasPresentedStartupDiag = false
        }))
        alert.addAction(UIAlertAction(title: localizedText(zh: "分享日志", en: "Share Logs"), style: .default, handler: { _ in
            let activity = UIActivityViewController(activityItems: [allLogs], applicationActivities: nil)
            presenter.present(activity, animated: true)
            StartupDiagnosticsLogStore.shared.append("diagnostics share sheet opened")
            self.hasPresentedStartupDiag = false
        }))
        alert.addAction(UIAlertAction(title: localizedText(zh: "关闭", en: "Close"), style: .cancel, handler: { _ in
            self.hasPresentedStartupDiag = false
        }))

        presenter.present(alert, animated: true)
        StartupDiagnosticsLogStore.shared.append("diagnostics dialog presented")
    }

    private func topViewController(base: UIViewController?) -> UIViewController? {
        if let nav = base as? UINavigationController {
            return topViewController(base: nav.visibleViewController)
        }
        if let tab = base as? UITabBarController, let selected = tab.selectedViewController {
            return topViewController(base: selected)
        }
        if let presented = base?.presentedViewController {
            return topViewController(base: presented)
        }
        return base
    }

    private func localizedText(zh: String, en: String) -> String {
        let lang = Locale.preferredLanguages.first?.lowercased() ?? ""
        return lang.hasPrefix("zh") ? zh : en
    }
}
