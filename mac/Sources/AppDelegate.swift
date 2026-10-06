import AppKit
import WebKit
import os

/// Orbit Lab's native shell: one window with a WKWebView running the bundled three.js app,
/// a standard Mac menu bar (Settings… ⌘, and scenario shortcuts ⌘1–⌘4), and a bridge that
/// stores preferences in UserDefaults and saves feedback to Application Support.
final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private let store = Store()
    static let repoURL = URL(string: "https://github.com/amalmehta/OrbitLab")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()

        let config = WKWebViewConfiguration()
        let controller = WKUserContentController()
        controller.add(self, name: "orbitLab")
        // Hand saved preferences to the page before any of its scripts run.
        controller.addUserScript(WKUserScript(
            source: "window.__ORBIT_LAB_STORE__ = \(store.json());",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true))
        // Forward page errors to the system log (Console.app, or stderr when run from a terminal).
        controller.addUserScript(WKUserScript(
            source: """
            window.addEventListener('error', e => window.webkit.messageHandlers.orbitLab.postMessage({ type: 'log', message: String(e.message) + ' @ ' + e.filename + ':' + e.lineno }));
            for (const level of ['warn', 'error']) {
              const original = console[level];
              console[level] = (...args) => { window.webkit.messageHandlers.orbitLab.postMessage({ type: 'log', message: level + ': ' + args.map(String).join(' ') }); original.apply(console, args); };
            }
            window.addEventListener('unhandledrejection', e => window.webkit.messageHandlers.orbitLab.postMessage({ type: 'log', message: 'Unhandled: ' + String(e.reason) }));
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true))
        config.userContentController = controller

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground") // no white flash before the page paints
        #if DEBUG
        webView.isInspectable = true
        #endif

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "Orbit Lab"
        window.minSize = NSSize(width: 980, height: 620)
        window.backgroundColor = NSColor(red: 0.02, green: 0.03, blue: 0.05, alpha: 1)
        window.contentView = webView
        window.setFrameAutosaveName("Orbit Lab Main Window")
        if !window.setFrameUsingName("Orbit Lab Main Window") { window.center() }
        window.makeKeyAndOrderFront(nil)

        guard let web = Bundle.main.resourceURL?.appendingPathComponent("web"),
              FileManager.default.fileExists(atPath: web.appendingPathComponent("index.html").path) else {
            webView.loadHTMLString("<body style='background:#05080d;color:#e8eef6;font:14px -apple-system;padding:40px'>Orbit Lab's web files are missing from the app bundle. Rebuild with <code>npm run mac</code>.</body>", baseURL: nil)
            return
        }
        webView.loadFileURL(web.appendingPathComponent("index.html"), allowingReadAccessTo: web)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // MARK: - Bridge

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "store":
            if let key = body["key"] as? String { store.set(key, body["value"]) }
        case "feedback":
            if let entry = body["entry"] as? [String: Any] { saveFeedback(entry) }
        case "openURL":
            if let s = body["url"] as? String, let url = URL(string: s), ["https", "http", "mailto"].contains(url.scheme ?? "") {
                NSWorkspace.shared.open(url)
            }
        case "log":
            os_log("Orbit Lab page: %{public}@", String(describing: body["message"] ?? ""))
        default:
            break
        }
    }

    // Links clicked inside the page open in the default browser, never inside the app.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url, url.scheme != "file" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { NSLog("Orbit Lab: page loaded") }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { NSLog("Orbit Lab: load failed: \(error)") }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { NSLog("Orbit Lab: load failed: \(error)") }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        NSLog("Orbit Lab: web content process ended; reloading")
        webView.reload()
    }

    private func saveFeedback(_ entry: [String: Any]) {
        do {
            let dir = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                .appendingPathComponent("Orbit Lab", isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let file = dir.appendingPathComponent("feedback.jsonl")
            var line = try JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys])
            line.append(0x0A)
            if let handle = try? FileHandle(forWritingTo: file) {
                handle.seekToEndOfFile()
                handle.write(line)
                try handle.close()
            } else {
                try line.write(to: file)
            }
        } catch {
            NSLog("Orbit Lab: could not save feedback: \(error)")
        }
    }

    private func callPage(_ js: String) {
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    // MARK: - Menu actions

    @objc func openSettings(_ sender: Any?) { callPage("window.orbitLab?.openSettings()") }
    @objc func openFeedback(_ sender: Any?) { callPage("window.orbitLab?.openFeedback()") }
    @objc func togglePause(_ sender: Any?) { callPage("window.orbitLab?.togglePause()") }
    @objc func openHelp(_ sender: Any?) { NSWorkspace.shared.open(Self.repoURL.appendingPathComponent("blob/main/docs/INSTRUCTIONS.md")) }
    @objc func selectMode(_ sender: NSMenuItem) {
        if let mode = sender.representedObject as? String { callPage("window.orbitLab?.setMode('\(mode)')") }
    }

    private func buildMenu() {
        let main = NSMenu()

        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Orbit Lab", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Settings…", action: #selector(openSettings(_:)), keyEquivalent: ",")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Orbit Lab", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Orbit Lab", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        main.addItem(submenu(appMenu, title: "Orbit Lab"))

        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        main.addItem(submenu(edit, title: "Edit"))

        let view = NSMenu(title: "View")
        for (i, (title, mode)) in [("Hohmann Transfer", "hohmann"), ("Gravity Assist", "assist"), ("Rendezvous", "rendezvous"), ("Docking Agent", "docking")].enumerated() {
            let item = view.addItem(withTitle: title, action: #selector(selectMode(_:)), keyEquivalent: "\(i + 1)")
            item.representedObject = mode
        }
        view.addItem(.separator())
        view.addItem(withTitle: "Play / Pause Flight", action: #selector(togglePause(_:)), keyEquivalent: "p")
        view.addItem(.separator())
        let fullScreen = view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        main.addItem(submenu(view, title: "View"))

        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        main.addItem(submenu(windowMenu, title: "Window"))
        NSApp.windowsMenu = windowMenu

        let help = NSMenu(title: "Help")
        help.addItem(withTitle: "Orbit Lab Help", action: #selector(openHelp(_:)), keyEquivalent: "?")
        help.addItem(withTitle: "Send Feedback…", action: #selector(openFeedback(_:)), keyEquivalent: "")
        main.addItem(submenu(help, title: "Help"))
        NSApp.helpMenu = help

        NSApp.mainMenu = main
    }

    private func submenu(_ menu: NSMenu, title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = menu
        return item
    }
}

/// Key–value store backed by UserDefaults; values are anything JSON can hold.
final class Store {
    private let defaults = UserDefaults.standard
    private let key = "OrbitLabStore"

    func set(_ name: String, _ value: Any?) {
        var all = defaults.dictionary(forKey: key) ?? [:]
        all[name] = value is NSNull ? nil : value
        defaults.set(all, forKey: key)
    }

    func json() -> String {
        let all = defaults.dictionary(forKey: key) ?? [:]
        guard JSONSerialization.isValidJSONObject(all),
              let data = try? JSONSerialization.data(withJSONObject: all),
              let s = String(data: data, encoding: .utf8) else { return "{}" }
        return s
    }
}
