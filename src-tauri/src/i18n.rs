use std::collections::HashMap;

const JA: &str = include_str!("../locales/ja.json");
const EN: &str = include_str!("../locales/en.json");

pub struct I18n {
    translations: serde_json::Value,
}

impl I18n {
    pub fn new() -> Self {
        let locale = detect_locale();
        let json = if locale.starts_with("ja") { JA } else { EN };
        let translations: serde_json::Value =
            serde_json::from_str(json).expect("failed to parse locale JSON");
        Self { translations }
    }

    /// Get a translation by dot-separated key (e.g. "menu.file_open")
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

    /// Return all translations as a flat map for the frontend
    pub fn flat_map(&self) -> HashMap<String, String> {
        let mut map = HashMap::new();
        flatten(&self.translations, String::new(), &mut map);
        map
    }

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

fn detect_locale() -> String {
    sys_locale::get_locale().unwrap_or_else(|| "en".to_string())
}
