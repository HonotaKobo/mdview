use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentEntry {
    pub path: String,
    pub title: String,
    pub last_opened: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct RecentData {
    version: u32,
    entries: Vec<RecentEntry>,
}

pub struct RecentStore {
    data: RecentData,
    file_path: PathBuf,
    max_entries: usize,
}

pub type RecentState = Mutex<RecentStore>;

impl RecentStore {
    pub fn load() -> Self {
        let file_path = Self::storage_path();
        let data = if file_path.exists() {
            match std::fs::read_to_string(&file_path) {
                Ok(json) => serde_json::from_str(&json).unwrap_or(RecentData {
                    version: 1,
                    entries: vec![],
                }),
                Err(_) => RecentData {
                    version: 1,
                    entries: vec![],
                },
            }
        } else {
            RecentData {
                version: 1,
                entries: vec![],
            }
        };
        // 既存エントリのパスを正規化（\\?\ プレフィックス除去）
        for entry in &mut data.entries {
            entry.path = crate::normalize_path(&entry.path);
        }
        Self {
            data,
            file_path,
            max_entries: 50,
        }
    }

    fn save(&self) {
        if let Some(parent) = self.file_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let tmp = self.file_path.with_extension("tmp");
        if let Ok(json) = serde_json::to_string_pretty(&self.data) {
            if std::fs::write(&tmp, &json).is_ok() {
                std::fs::rename(&tmp, &self.file_path).ok();
            }
        }
    }

    fn storage_path() -> PathBuf {
        let base = if cfg!(target_os = "macos") {
            dirs::config_dir().unwrap_or_else(|| PathBuf::from("."))
        } else if cfg!(target_os = "windows") {
            dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))
        } else {
            dirs::config_dir().unwrap_or_else(|| PathBuf::from("."))
        };
        base.join("tsumugi").join("recent.json")
    }

    pub fn add(&mut self, path: &str, title: &str) {
        let path = crate::normalize_path(path);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // 同じパスの既存エントリを削除
        self.data.entries.retain(|e| e.path != path);

        // 先頭に挿入
        self.data.entries.insert(
            0,
            RecentEntry {
                path: path.to_string(),
                title: title.to_string(),
                last_opened: now,
            },
        );

        // 最大数に切り詰め
        self.data.entries.truncate(self.max_entries);
        self.save();
    }

    pub fn remove(&mut self, path: &str) {
        self.data.entries.retain(|e| e.path != path);
        self.save();
    }

    pub fn clear(&mut self) {
        self.data.entries.clear();
        self.save();
    }

    pub fn get_all(&self) -> Vec<RecentEntry> {
        self.data.entries.clone()
    }
}
