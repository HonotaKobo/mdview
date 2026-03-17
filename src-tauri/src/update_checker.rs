use serde::Serialize;

const GITHUB_REPO: &str = "HonotaKobo/tsumugi";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Serialize)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_url: String,
}

#[derive(Serialize)]
pub struct UpdateResult {
    pub success: bool,
    pub message: String,
}

pub fn check_update() -> Result<UpdateInfo, String> {
    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        GITHUB_REPO
    );

    let response = ureq::get(&url)
        .set("User-Agent", "tsumugi")
        .set("Accept", "application/vnd.github.v3+json")
        .call()
        .map_err(|e| format!("{}", e))?;

    let body: serde_json::Value = response
        .into_json()
        .map_err(|e| format!("{}", e))?;

    let tag_name = body["tag_name"]
        .as_str()
        .ok_or("Missing tag_name in response")?;

    let latest_version = tag_name.trim_start_matches('v');
    let release_url = body["html_url"]
        .as_str()
        .unwrap_or(&format!(
            "https://github.com/{}/releases/latest",
            GITHUB_REPO
        ))
        .to_string();

    let has_update = version_gt(latest_version, CURRENT_VERSION);

    Ok(UpdateInfo {
        has_update,
        current_version: CURRENT_VERSION.to_string(),
        latest_version: latest_version.to_string(),
        release_url,
    })
}

pub fn perform_update() -> UpdateResult {
    match std::env::consts::OS {
        "macos" => {
            match find_brew() {
                Some(brew) => run_chained(&brew, &["update"], &["upgrade", "--cask", "tsumugi"]),
                None => UpdateResult {
                    success: false,
                    message: "Homebrew が見つかりません。\nhttps://brew.sh からインストールしてください。".to_string(),
                },
            }
        }
        "windows" => {
            match find_scoop() {
                Some(scoop) => {
                    // scoopバケットが登録されていることを確認する（既に追加済みなら何もしない）
                    let _ = std::process::Command::new("cmd.exe")
                        .args(["/C", scoop.as_str(), "bucket", "add", "tsumugi",
                               "https://github.com/HonotaKobo/scoop-tsumugi"])
                        .output();
                    run_chained("cmd.exe",
                        &["/C", scoop.as_str(), "update"],
                        &["/C", scoop.as_str(), "update", "tsumugi"])
                }
                None => UpdateResult {
                    success: false,
                    message: "Scoop が見つかりません。\nhttps://scoop.sh からインストールしてください。".to_string(),
                },
            }
        }
        _ => UpdateResult {
            success: false,
            message: "Automatic update is not supported on this platform.".to_string(),
        },
    }
}

/// `brew`実行ファイルを探す。
/// macOSのGUIアプリはユーザーのシェルPATHを継承しないため、
/// まず既知のインストールディレクトリを確認する。
fn find_brew() -> Option<String> {
    // Apple Silicon（Appleシリコン）
    let apple_silicon = "/opt/homebrew/bin/brew";
    if std::path::Path::new(apple_silicon).exists() {
        return Some(apple_silicon.to_string());
    }
    // Intel Mac（インテルMac）
    let intel = "/usr/local/bin/brew";
    if std::path::Path::new(intel).exists() {
        return Some(intel.to_string());
    }
    None
}

/// Windows上で`scoop.cmd`シムを探す。
/// GUIアプリはユーザーのシェルPATHを継承しないため、
/// 既知のインストールディレクトリを確認する。
fn find_scoop() -> Option<String> {
    // SCOOP環境変数によるカスタムインストール場所
    if let Ok(scoop_dir) = std::env::var("SCOOP") {
        let path = std::path::PathBuf::from(&scoop_dir).join("shims").join("scoop.cmd");
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }
    // デフォルト: %USERPROFILE%\scoop
    if let Ok(home) = std::env::var("USERPROFILE") {
        let path = std::path::PathBuf::from(&home).join("scoop").join("shims").join("scoop.cmd");
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }
    None
}

fn run_chained(cmd: &str, pre_args: &[&str], args: &[&str]) -> UpdateResult {
    if let Err(e) = std::process::Command::new(cmd).args(pre_args).output() {
        return UpdateResult {
            success: false,
            message: format!("{}", e),
        };
    }
    run_command(cmd, args)
}

fn run_command(cmd: &str, args: &[&str]) -> UpdateResult {
    match std::process::Command::new(cmd).args(args).output() {
        Ok(output) if output.status.success() => UpdateResult {
            success: true,
            message: String::from_utf8_lossy(&output.stdout).to_string(),
        },
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            UpdateResult {
                success: false,
                message: format!("{}{}", stdout, stderr),
            }
        }
        Err(e) => UpdateResult {
            success: false,
            message: format!("{}", e),
        },
    }
}

fn version_gt(a: &str, b: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.split('.').filter_map(|s| s.parse().ok()).collect()
    };
    parse(a) > parse(b)
}
