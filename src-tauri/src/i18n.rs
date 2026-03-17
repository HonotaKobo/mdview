use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

const JA: &str = include_str!("../locales/ja.json");
const EN: &str = include_str!("../locales/en.json");

#[derive(Debug, Clone, PartialEq)]
pub enum Locale {
    En,
    Ja,
    Custom,
}

pub struct I18n {
    translations: serde_json::Value,
    locale: Locale,
}

pub type I18nState = Mutex<I18n>;

impl I18n {
    pub fn new() -> Self {
        ensure_custom_locale();
        let locale = load_locale_setting();
        Self::with_locale(locale)
    }

    pub fn with_locale(locale: Locale) -> Self {
        let translations = match &locale {
            Locale::En => serde_json::from_str(EN).expect("failed to parse EN locale JSON"),
            Locale::Ja => serde_json::from_str(JA).expect("failed to parse JA locale JSON"),
            Locale::Custom => {
                let base: serde_json::Value =
                    serde_json::from_str(EN).expect("failed to parse EN locale JSON");
                let path = custom_locale_path();
                let custom_json = std::fs::read_to_string(&path)
                    .unwrap_or_else(|_| EN.to_string());
                let mut custom: serde_json::Value = serde_json::from_str(&custom_json)
                    .unwrap_or_else(|_| base.clone());
                // ENからカスタムに不足キーを補完し、追加があれば保存
                if deep_fill_missing(&mut custom, &base) {
                    if let Ok(json) = serde_json::to_string_pretty(&custom) {
                        let tmp = path.with_extension("tmp");
                        if std::fs::write(&tmp, &json).is_ok() {
                            std::fs::rename(&tmp, &path).ok();
                        }
                    }
                }
                custom
            }
        };
        Self { translations, locale }
    }

    pub fn locale(&self) -> &Locale {
        &self.locale
    }

    /// ドット区切りのキーで翻訳を取得する（例: "menu.file_open"）
    pub fn t(&self, key: &str) -> String {
        let mut current = &self.translations;
        for part in key.split('.') {
            match current.get(part) {
                Some(v) => current = v,
                None => return key.to_string(),
            }
        }
        current.as_str().map(|s| s.to_string()).unwrap_or_else(|| key.to_string())
    }

    /// フロントエンド用に全翻訳をフラットマップとして返す
    pub fn flat_map(&self) -> HashMap<String, String> {
        let mut map = HashMap::new();
        flatten(&self.translations, String::new(), &mut map);
        map
    }

}

/// `source`から`target`に不足しているキーを再帰的に補完する。
/// キーが追加された場合はtrueを返す。
fn deep_fill_missing(target: &mut serde_json::Value, source: &serde_json::Value) -> bool {
    let mut changed = false;
    if let (Some(target_obj), Some(source_obj)) = (target.as_object_mut(), source.as_object()) {
        for (key, source_val) in source_obj {
            if let Some(target_val) = target_obj.get_mut(key) {
                // 両方にキーが存在する — 両方がオブジェクトなら再帰
                if target_val.is_object() && source_val.is_object() {
                    if deep_fill_missing(target_val, source_val) {
                        changed = true;
                    }
                }
            } else {
                // カスタムにキーが不足 — ENから追加
                target_obj.insert(key.clone(), source_val.clone());
                changed = true;
            }
        }
    }
    changed
}

fn flatten(value: &serde_json::Value, prefix: String, map: &mut HashMap<String, String>) {
    match value {
        serde_json::Value::Object(obj) => {
            for (k, v) in obj {
                let key = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{}.{}", prefix, k)
                };
                flatten(v, key, map);
            }
        }
        serde_json::Value::String(s) => {
            map.insert(prefix, s.clone());
        }
        _ => {}
    }
}

fn config_dir() -> PathBuf {
    let base = if cfg!(target_os = "macos") {
        dirs::config_dir().unwrap_or_else(|| PathBuf::from("."))
    } else if cfg!(target_os = "windows") {
        dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))
    } else {
        dirs::config_dir().unwrap_or_else(|| PathBuf::from("."))
    };
    base.join("tsumugi")
}

pub fn custom_locale_path() -> PathBuf {
    config_dir().join("custom_locale.json")
}

fn locale_setting_path() -> PathBuf {
    config_dir().join("locale.txt")
}

fn ensure_custom_locale() {
    let path = custom_locale_path();
    if !path.exists() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(&path, EN).ok();
    }
}

fn load_locale_setting() -> Locale {
    let path = locale_setting_path();
    if let Ok(s) = std::fs::read_to_string(&path) {
        match s.trim() {
            "en" => Locale::En,
            "ja" => Locale::Ja,
            "custom" => Locale::Custom,
            _ => detect_system_locale(),
        }
    } else {
        detect_system_locale()
    }
}

pub fn save_locale_setting(locale: &Locale) {
    let path = locale_setting_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let s = match locale {
        Locale::En => "en",
        Locale::Ja => "ja",
        Locale::Custom => "custom",
    };
    std::fs::write(&path, s).ok();
}

fn detect_system_locale() -> Locale {
    let locale = sys_locale::get_locale().unwrap_or_else(|| "en".to_string());
    if locale.starts_with("ja") { Locale::Ja } else { Locale::En }
}
