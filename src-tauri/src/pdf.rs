use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::command;

use crate::commands::validate_path;

/// macOS: Chromiumベースのブラウザを探索する
#[cfg(target_os = "macos")]
fn find_browser() -> Option<PathBuf> {
    let candidates = [
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
    candidates.iter().map(PathBuf::from).find(|p| p.exists())
}

/// Windows: Chromiumベースのブラウザを探索する
#[cfg(target_os = "windows")]
fn find_browser() -> Option<PathBuf> {
    let candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ];
    candidates.iter().map(PathBuf::from).find(|p| p.exists())
}

/// ファイルパスをfile:// URLに変換する
fn path_to_file_url(path: &Path) -> String {
    #[cfg(unix)]
    {
        format!("file://{}", path.display())
    }
    #[cfg(windows)]
    {
        format!(
            "file:///{}",
            path.display().to_string().replace('\\', "/")
        )
    }
}

/// ブラウザのheadlessモードでHTMLをPDFに変換する
fn generate_pdf_with_browser(
    browser: &Path,
    html_path: &Path,
    output_path: &Path,
) -> Result<(), String> {
    let output_arg = format!("--print-to-pdf={}", output_path.display());
    let html_url = path_to_file_url(html_path);

    // --no-pdf-header-footer を使用（新しいChromiumバージョン向け）
    let _ = Command::new(browser)
        .args([
            "--headless=old",
            "--disable-gpu",
            "--no-pdf-header-footer",
            &output_arg,
            &html_url,
        ])
        .output()
        .map_err(|e| format!("Failed to launch browser: {}", e))?;

    if output_path.exists() {
        return Ok(());
    }

    // フォールバック: --print-to-pdf-no-header（古いChromium互換）
    let result = Command::new(browser)
        .args([
            "--headless=old",
            "--disable-gpu",
            "--print-to-pdf-no-header",
            &output_arg,
            &html_url,
        ])
        .output()
        .map_err(|e| format!("Failed to launch browser: {}", e))?;

    if output_path.exists() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&result.stderr);
        Err(format!("PDF generation failed: {}", stderr))
    }
}

/// macOS: WKWebViewベースのsidecarでPDFを生成する
#[cfg(target_os = "macos")]
async fn generate_pdf_with_sidecar(
    app: &tauri::AppHandle,
    html_path: &Path,
    output_path: &Path,
) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;

    let output = app
        .shell()
        .sidecar("tsumugi-pdf")
        .map_err(|e| format!("Failed to find sidecar: {}", e))?
        .args([
            html_path.to_string_lossy().as_ref(),
            output_path.to_string_lossy().as_ref(),
        ])
        .output()
        .await
        .map_err(|e| format!("Sidecar execution failed: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("PDF generation failed (sidecar): {}", stderr))
    }
}

/// ブラウザが見つからない場合のフォールバック
#[cfg(target_os = "macos")]
async fn pdf_fallback(
    app: &tauri::AppHandle,
    html_path: &Path,
    output_path: &Path,
) -> Result<(), String> {
    generate_pdf_with_sidecar(app, html_path, output_path).await
}

#[cfg(not(target_os = "macos"))]
async fn pdf_fallback(
    _app: &tauri::AppHandle,
    _html_path: &Path,
    _output_path: &Path,
) -> Result<(), String> {
    Err("No Chromium-based browser found. Please install Chrome or Edge.".to_string())
}

#[command]
pub async fn export_pdf(
    app: tauri::AppHandle,
    html_content: String,
    output_path: String,
) -> Result<(), String> {
    let output = validate_path(&output_path)?;

    // 一時HTMLファイルを作成
    let temp = tempfile::Builder::new()
        .suffix(".html")
        .tempfile()
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    std::fs::write(temp.path(), &html_content)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    // ブラウザでPDF生成を試行
    if let Some(browser) = find_browser() {
        return generate_pdf_with_browser(&browser, temp.path(), &output);
    }

    // フォールバック（macOS: sidecar / Windows: エラー）
    pdf_fallback(&app, temp.path(), &output).await
}

#[command]
pub fn has_pdf_browser() -> bool {
    // macOSではsidecarフォールバックがあるため常にtrue
    #[cfg(target_os = "macos")]
    {
        true
    }
    #[cfg(not(target_os = "macos"))]
    {
        find_browser().is_some()
    }
}
