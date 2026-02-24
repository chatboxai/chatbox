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
    private var diagnosticsOverlayWindow: UIWindow?

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

        hasPresentedStartupDiag = true
        let allLogs = StartupDiagnosticsLogStore.shared.dump()
        let preview = StartupDiagnosticsLogStore.shared.tailPreview(limit: 40)
        let message = "\(reason)\n\n\(localizedText(zh: "以下为最近日志预览（完整日志见下方文本，可直接复制）：", en: "Recent log preview (full logs are shown below and can be copied):"))\n\n\(preview)"
        showDiagnosticsOverlay(message: message, fullLogs: allLogs)
    }

    private func showDiagnosticsOverlay(message: String, fullLogs: String) {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first(where: { $0.activationState == .foregroundActive })
            ?? UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first(where: { $0.activationState == .foregroundInactive })

        let overlayWindow: UIWindow
        if let scene {
            overlayWindow = UIWindow(windowScene: scene)
        } else {
            overlayWindow = UIWindow(frame: UIScreen.main.bounds)
        }

        let title = localizedText(zh: "启动诊断日志", en: "Startup Diagnostics")
        let copyTitle = localizedText(zh: "复制日志", en: "Copy Logs")
        let shareTitle = localizedText(zh: "分享日志", en: "Share Logs")
        let closeTitle = localizedText(zh: "关闭", en: "Close")
        let viewController = StartupDiagnosticsViewController(
            titleText: title,
            message: message,
            fullLogs: fullLogs,
            copyButtonTitle: copyTitle,
            shareButtonTitle: shareTitle,
            closeButtonTitle: closeTitle
        )

        viewController.onCopy = { [weak self] logs in
            UIPasteboard.general.string = logs
            StartupDiagnosticsLogStore.shared.append("diagnostics copied to pasteboard")
            self?.hasPresentedStartupDiag = false
        }
        viewController.onShare = { logs, presenter in
            let activity = UIActivityViewController(activityItems: [logs], applicationActivities: nil)
            presenter.present(activity, animated: true)
            StartupDiagnosticsLogStore.shared.append("diagnostics share sheet opened")
        }
        viewController.onClose = { [weak self] in
            self?.dismissDiagnosticsOverlay()
        }

        overlayWindow.windowLevel = .alert + 1
        overlayWindow.backgroundColor = .clear
        overlayWindow.rootViewController = viewController
        overlayWindow.makeKeyAndVisible()

        diagnosticsOverlayWindow = overlayWindow
        StartupDiagnosticsLogStore.shared.append("diagnostics overlay presented")
    }

    private func dismissDiagnosticsOverlay() {
        diagnosticsOverlayWindow?.isHidden = true
        diagnosticsOverlayWindow = nil
        window?.makeKeyAndVisible()
        hasPresentedStartupDiag = false
        StartupDiagnosticsLogStore.shared.append("diagnostics overlay dismissed")
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

private final class StartupDiagnosticsViewController: UIViewController {
    var onCopy: ((String) -> Void)?
    var onShare: ((String, UIViewController) -> Void)?
    var onClose: (() -> Void)?

    private let titleText: String
    private let message: String
    private let fullLogs: String
    private let copyButtonTitle: String
    private let shareButtonTitle: String
    private let closeButtonTitle: String

    init(
        titleText: String,
        message: String,
        fullLogs: String,
        copyButtonTitle: String,
        shareButtonTitle: String,
        closeButtonTitle: String
    ) {
        self.titleText = titleText
        self.message = message
        self.fullLogs = fullLogs
        self.copyButtonTitle = copyButtonTitle
        self.shareButtonTitle = shareButtonTitle
        self.closeButtonTitle = closeButtonTitle
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overFullScreen
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.45)

        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false
        container.backgroundColor = .systemBackground
        container.layer.cornerRadius = 14
        container.layer.masksToBounds = true
        view.addSubview(container)

        let titleLabel = UILabel()
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.text = titleText
        titleLabel.font = .boldSystemFont(ofSize: 18)
        titleLabel.textAlignment = .center

        let logsView = UITextView()
        logsView.translatesAutoresizingMaskIntoConstraints = false
        logsView.text = "\(message)\n\n\(fullLogs)"
        logsView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        logsView.textColor = .label
        logsView.backgroundColor = .secondarySystemBackground
        logsView.isEditable = false
        logsView.isSelectable = true
        logsView.layer.cornerRadius = 8

        let copyButton = UIButton(type: .system)
        copyButton.translatesAutoresizingMaskIntoConstraints = false
        copyButton.setTitle(copyButtonTitle, for: .normal)
        copyButton.addTarget(self, action: #selector(copyTapped), for: .touchUpInside)

        let shareButton = UIButton(type: .system)
        shareButton.translatesAutoresizingMaskIntoConstraints = false
        shareButton.setTitle(shareButtonTitle, for: .normal)
        shareButton.addTarget(self, action: #selector(shareTapped), for: .touchUpInside)

        let closeButton = UIButton(type: .system)
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.setTitle(closeButtonTitle, for: .normal)
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)

        let buttonStack = UIStackView(arrangedSubviews: [copyButton, shareButton, closeButton])
        buttonStack.translatesAutoresizingMaskIntoConstraints = false
        buttonStack.axis = .horizontal
        buttonStack.alignment = .fill
        buttonStack.distribution = .fillEqually
        buttonStack.spacing = 12

        container.addSubview(titleLabel)
        container.addSubview(logsView)
        container.addSubview(buttonStack)

        NSLayoutConstraint.activate([
            container.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 18),
            container.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -18),
            container.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            container.heightAnchor.constraint(equalTo: view.heightAnchor, multiplier: 0.7),

            titleLabel.topAnchor.constraint(equalTo: container.topAnchor, constant: 16),
            titleLabel.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 16),
            titleLabel.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -16),

            logsView.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 12),
            logsView.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 12),
            logsView.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -12),
            logsView.bottomAnchor.constraint(equalTo: buttonStack.topAnchor, constant: -12),

            buttonStack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 12),
            buttonStack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -12),
            buttonStack.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -12),
            buttonStack.heightAnchor.constraint(equalToConstant: 40)
        ])
    }

    @objc private func copyTapped() {
        onCopy?(fullLogs)
    }

    @objc private func shareTapped() {
        onShare?(fullLogs, self)
    }

    @objc private func closeTapped() {
        onClose?()
    }
}
