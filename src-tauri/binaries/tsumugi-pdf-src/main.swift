import Foundation
import WebKit
import AppKit

class PDFGenerator: NSObject, WKNavigationDelegate {
    let htmlPath: String
    let outputPath: String
    var webView: WKWebView?

    init(htmlPath: String, outputPath: String) {
        self.htmlPath = htmlPath
        self.outputPath = outputPath
    }

    func run() {
        let config = WKWebViewConfiguration()
        // A4幅（595.28pt）でレイアウト
        let webView = WKWebView(
            frame: NSRect(x: 0, y: 0, width: 595.28, height: 842),
            configuration: config
        )
        webView.navigationDelegate = self
        self.webView = webView

        // HTTP URLの場合はURLRequestで読み込み、それ以外はファイルURLとして読み込む
        if htmlPath.hasPrefix("http://") || htmlPath.hasPrefix("https://") {
            guard let url = URL(string: htmlPath) else {
                fputs("Error: Invalid URL: \(htmlPath)\n", stderr)
                exit(1)
            }
            webView.load(URLRequest(url: url))
        } else {
            let htmlURL = URL(fileURLWithPath: htmlPath)
            webView.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())
        }

        // 30秒タイムアウト
        DispatchQueue.main.asyncAfter(deadline: .now() + 30.0) {
            fputs("Error: Timeout waiting for page load\n", stderr)
            exit(1)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // レンダリング完了を少し待ってからPDF生成
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [self] in
            let config = WKPDFConfiguration()

            webView.createPDF(configuration: config) { result in
                switch result {
                case .success(let data):
                    do {
                        try data.write(to: URL(fileURLWithPath: self.outputPath))
                        exit(0)
                    } catch {
                        fputs("Error: Failed to write PDF: \(error)\n", stderr)
                        exit(1)
                    }
                case .failure(let error):
                    fputs("Error: Failed to create PDF: \(error)\n", stderr)
                    exit(1)
                }
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fputs("Error: Navigation failed: \(error)\n", stderr)
        exit(1)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fputs("Error: Provisional navigation failed: \(error)\n", stderr)
        exit(1)
    }
}

// 引数バリデーション
guard CommandLine.arguments.count == 3 else {
    fputs("Usage: tsumugi-pdf <html_path> <output_path>\n", stderr)
    exit(1)
}

let htmlPath = CommandLine.arguments[1]
let outputPath = CommandLine.arguments[2]

// WKWebViewはGUIスレッドが必要 → NSApplicationのRunLoopを使用
let app = NSApplication.shared
let generator = PDFGenerator(htmlPath: htmlPath, outputPath: outputPath)
generator.run()
app.run()
