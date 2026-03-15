use serde::Serialize;

const GITHUB_REPO: &str = "HonotaKobo/mdcast";
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
        .set("User-Agent", "mdcast")
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
        "macos" => run_chained("brew", &["update"], &["upgrade", "--cask", "mdcast"]),
        "windows" => run_chained("scoop", &["update"], &["update", "mdcast"]),
        _ => UpdateResult {
            success: false,
            message: "Automatic update is not supported on this platform.".to_string(),
        },
    }
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
