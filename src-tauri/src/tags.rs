use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TagEntry {
    pub path: String,
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct TagData {
    version: u32,
    entries: Vec<TagEntry>,
}

pub struct TagStore {
    data: TagData,
    file_path: PathBuf,
}

pub type TagState = Mutex<TagStore>;

impl TagStore {
    pub fn load() -> Self {
        let file_path = Self::storage_path();
        let data = if file_path.exists() {
            match std::fs::read_to_string(&file_path) {
                Ok(json) => serde_json::from_str(&json).unwrap_or(TagData {
                    version: 1,
                    entries: vec![],
                }),
                Err(_) => TagData {
                    version: 1,
                    entries: vec![],
                },
            }
        } else {
            TagData {
                version: 1,
                entries: vec![],
            }
        };
        // 既存エントリのパスを正規化（\\?\ プレフィックス除去）
        for entry in &mut data.entries {
            entry.path = crate::normalize_path(&entry.path);
        }
        Self { data, file_path }
    }

    pub fn reload(&mut self) {
        if self.file_path.exists() {
            if let Ok(json) = std::fs::read_to_string(&self.file_path) {
                if let Ok(data) = serde_json::from_str(&json) {
                    self.data = data;
                }
            }
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
        base.join("tsumugi").join("tags.json")
    }

    fn find_entry_mut(&mut self, path: &str) -> Option<&mut TagEntry> {
        self.data.entries.iter_mut().find(|e| e.path == path)
    }

    pub fn add_tag(&mut self, path: &str, tag: &str) {
        if let Some(entry) = self.find_entry_mut(path) {
            if !entry.tags.contains(&tag.to_string()) {
                entry.tags.push(tag.to_string());
            }
        } else {
            self.data.entries.push(TagEntry {
                path: path.to_string(),
                tags: vec![tag.to_string()],
                memo: None,
            });
        }
        self.save();
    }

    pub fn remove_tag(&mut self, path: &str, tag: &str) {
        if let Some(entry) = self.find_entry_mut(path) {
            entry.tags.retain(|t| t != tag);
            if entry.tags.is_empty() {
                self.data.entries.retain(|e| e.path != path);
            }
        }
        self.save();
    }

    pub fn set_tags(&mut self, path: &str, tags: Vec<String>) {
        if tags.is_empty() {
            self.data.entries.retain(|e| e.path != path);
        } else if let Some(entry) = self.find_entry_mut(path) {
            entry.tags = tags;
        } else {
            self.data.entries.push(TagEntry {
                path: path.to_string(),
                tags,
                memo: None,
            });
        }
        self.save();
    }

    pub fn get_tags(&self, path: &str) -> Vec<String> {
        self.data
            .entries
            .iter()
            .find(|e| e.path == path)
            .map(|e| e.tags.clone())
            .unwrap_or_default()
    }

    pub fn get_all_entries(&self) -> Vec<TagEntry> {
        self.data.entries.clone()
    }

    pub fn delete_entry(&mut self, path: &str) {
        self.data.entries.retain(|e| e.path != path);
        self.save();
    }

    pub fn relink(&mut self, old_path: &str, new_path: &str) {
        if let Some(entry) = self.find_entry_mut(old_path) {
            entry.path = new_path.to_string();
        }
        self.save();
    }

    pub fn set_memo(&mut self, path: &str, memo: Option<String>) {
        let memo = memo.filter(|m| !m.is_empty());
        if let Some(entry) = self.find_entry_mut(path) {
            entry.memo = memo;
            self.save();
        }
    }

    pub fn validate_paths(&self) -> Vec<(String, bool)> {
        self.data
            .entries
            .iter()
            .map(|e| (e.path.clone(), std::path::Path::new(&e.path).exists()))
            .collect()
    }

    pub fn get_all_unique_tags(&self) -> Vec<String> {
        let mut tags = std::collections::BTreeSet::new();
        for entry in &self.data.entries {
            for tag in &entry.tags {
                tags.insert(tag.clone());
            }
        }
        tags.into_iter().collect()
    }

    pub fn batch_add(&mut self, paths: &[String], tag: &str) {
        for path in paths {
            if let Some(entry) = self.data.entries.iter_mut().find(|e| e.path == *path) {
                if !entry.tags.contains(&tag.to_string()) {
                    entry.tags.push(tag.to_string());
                }
            } else {
                self.data.entries.push(TagEntry {
                    path: path.clone(),
                    tags: vec![tag.to_string()],
                    memo: None,
                });
            }
        }
        self.save();
    }

    pub fn rename_all(&mut self, old_name: &str, new_name: &str) {
        for entry in &mut self.data.entries {
            for tag in &mut entry.tags {
                if tag == old_name {
                    *tag = new_name.to_string();
                }
            }
        }
        self.save();
    }

    pub fn remove_all(&mut self, tag_name: &str) {
        for entry in &mut self.data.entries {
            entry.tags.retain(|t| t != tag_name);
        }
        self.data.entries.retain(|e| !e.tags.is_empty());
        self.save();
    }

    pub fn get_counts(&self) -> Vec<(String, usize)> {
        let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for entry in &self.data.entries {
            for tag in &entry.tags {
                *counts.entry(tag.clone()).or_insert(0) += 1;
            }
        }
        let mut result: Vec<(String, usize)> = counts.into_iter().collect();
        result.sort_by(|a, b| a.0.cmp(&b.0));
        result
    }
}
