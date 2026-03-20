use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::Hasher;
use std::path::PathBuf;
use std::sync::Mutex;

/// 最小記録間隔（秒）
const MIN_RECORD_INTERVAL_SECS: u64 = 10;

/// 30日（秒）
const CLEANUP_MAX_AGE_SECS: u64 = 30 * 24 * 3600;

/// 設定
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HistoryConfig {
    pub enabled: bool,
    pub snapshot_interval: u32,
    pub include_network_paths: bool,
    pub include_temp_files: bool,
}

impl Default for HistoryConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            snapshot_interval: 20,
            include_network_paths: false,
            include_temp_files: false,
        }
    }
}

/// 履歴エントリ（JSONLの各行）
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum HistoryEntry {
    #[serde(rename = "snapshot")]
    Snapshot {
        t: u64,
        p: String,
        c: String,
        saved: bool,
    },
    #[serde(rename = "delta")]
    Delta {
        t: u64,
        p: String,
        d: String,
        saved: bool,
    },
}

/// 履歴ファイルのメタ情報
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HistoryFileMeta {
    pub file_hash: String,
    pub file_path: String,
    pub entry_count: usize,
    pub last_timestamp: u64,
    pub has_unsaved: bool,
}

/// ファイルごとの追跡状態
struct FileTracker {
    last_recorded_content: String,
    last_recorded_at: u64,
    delta_count_since_snapshot: u32,
    file_hash: String,
    file_path: Option<String>,
}

/// 履歴ストア
pub struct HistoryStore {
    config: HistoryConfig,
    trackers: HashMap<String, FileTracker>,
}

pub type HistoryState = Mutex<HistoryStore>;

impl HistoryStore {
    pub fn load() -> Self {
        let config_path = config_path();
        let config = if config_path.exists() {
            std::fs::read_to_string(&config_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            HistoryConfig::default()
        };
        Self {
            config,
            trackers: HashMap::new(),
        }
    }

    pub fn config(&self) -> &HistoryConfig {
        &self.config
    }

    pub fn set_config(&mut self, config: HistoryConfig) {
        self.config = config;
        self.save_config();
    }

    fn save_config(&self) {
        let path = config_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        if let Ok(json) = serde_json::to_string_pretty(&self.config) {
            std::fs::write(&path, json).ok();
        }
    }

    /// 追跡を開始し、初回スナップショットを書き込む
    pub fn start_tracking(
        &mut self,
        label: &str,
        initial_content: &str,
        file_path: Option<&str>,
    ) {
        if !self.config.enabled {
            return;
        }

        // ファイルパスがない場合、include_temp_filesがfalseなら追跡しない
        if file_path.is_none() && !self.config.include_temp_files {
            return;
        }

        // ネットワークパスチェック
        if let Some(fp) = file_path {
            if is_network_path(fp) && !self.config.include_network_paths {
                return;
            }
        }

        let hash = path_hash(file_path.unwrap_or(label));
        let now = now_secs();

        // 初回スナップショットを書き込む
        let entry = HistoryEntry::Snapshot {
            t: now,
            p: file_path.unwrap_or("").to_string(),
            c: initial_content.to_string(),
            saved: true,
        };
        append_entry(&hash, &entry);

        self.trackers.insert(
            label.to_string(),
            FileTracker {
                last_recorded_content: initial_content.to_string(),
                last_recorded_at: now,
                delta_count_since_snapshot: 0,
                file_hash: hash,
                file_path: file_path.map(|s| s.to_string()),
            },
        );
    }

    /// 追跡を停止
    pub fn stop_tracking(&mut self, label: &str) {
        self.trackers.remove(label);
    }

    /// 変更を記録
    pub fn record_change(
        &mut self,
        label: &str,
        content: &str,
        saved_path: Option<&str>,
        is_saved: bool,
    ) {
        if !self.config.enabled {
            return;
        }

        // 一時ファイルチェック
        if saved_path.is_none() && !self.config.include_temp_files {
            return;
        }

        // ネットワークパスチェック
        if let Some(fp) = saved_path {
            if is_network_path(fp) && !self.config.include_network_paths {
                return;
            }
        }

        let snapshot_interval = self.config.snapshot_interval;

        let tracker = match self.trackers.get_mut(label) {
            Some(t) => t,
            None => return,
        };

        let now = now_secs();

        // 最小間隔チェック
        if now - tracker.last_recorded_at < MIN_RECORD_INTERVAL_SECS {
            return;
        }

        // 変更なしチェック
        if content == tracker.last_recorded_content {
            return;
        }

        // saved_pathが変わった場合（名前を付けて保存した場合等）、ハッシュを更新
        if let Some(fp) = saved_path {
            let new_hash = path_hash(fp);
            if new_hash != tracker.file_hash {
                tracker.file_hash = new_hash;
                tracker.file_path = Some(fp.to_string());
                // 新しいファイルとして初回スナップショットを書き込む
                let entry = HistoryEntry::Snapshot {
                    t: now,
                    p: fp.to_string(),
                    c: content.to_string(),
                    saved: is_saved,
                };
                append_entry(&tracker.file_hash, &entry);
                tracker.last_recorded_content = content.to_string();
                tracker.last_recorded_at = now;
                tracker.delta_count_since_snapshot = 0;
                return;
            }
        }

        // 差分を計算
        let dmp = diff_match_patch_rs::DiffMatchPatch::new();
        match dmp.diff_main::<diff_match_patch_rs::Compat>(
            &tracker.last_recorded_content,
            content,
        ) {
            Ok(diffs) => {
                match dmp.diff_to_delta(&diffs) {
                    Ok(delta) => {
                        let path_str = saved_path.unwrap_or("").to_string();
                        let entry = HistoryEntry::Delta {
                            t: now,
                            p: path_str.clone(),
                            d: delta,
                            saved: is_saved,
                        };
                        append_entry(&tracker.file_hash, &entry);
                        tracker.delta_count_since_snapshot += 1;

                        // スナップショット間隔に達した場合
                        if tracker.delta_count_since_snapshot >= snapshot_interval {
                            let snapshot = HistoryEntry::Snapshot {
                                t: now,
                                p: path_str,
                                c: content.to_string(),
                                saved: is_saved,
                            };
                            append_entry(&tracker.file_hash, &snapshot);
                            tracker.delta_count_since_snapshot = 0;
                        }
                    }
                    Err(e) => {
                        eprintln!("tsumugi: history delta error: {:?}", e);
                    }
                }
            }
            Err(e) => {
                eprintln!("tsumugi: history diff error: {:?}", e);
            }
        }

        tracker.last_recorded_content = content.to_string();
        tracker.last_recorded_at = now;
    }
}

// --- 独立関数 ---

/// 指定タイムスタンプの時点のコンテンツを復元する
pub fn restore_at(file_hash: &str, target_timestamp: u64) -> Result<String, String> {
    let path = history_file_path(file_hash);
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read history: {}", e))?;

    let mut entries: Vec<HistoryEntry> = Vec::new();
    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str(line) {
            Ok(entry) => entries.push(entry),
            Err(_) => continue, // 壊れた行はスキップ
        }
    }

    if entries.is_empty() {
        return Err("No history entries".to_string());
    }

    // target_timestamp == 0 の場合、最新の状態を復元
    let target = if target_timestamp == 0 {
        u64::MAX
    } else {
        target_timestamp
    };

    // ターゲット以前の最後のスナップショットを見つける
    let mut last_snapshot_idx = None;
    for (i, entry) in entries.iter().enumerate() {
        let t = match entry {
            HistoryEntry::Snapshot { t, .. } => *t,
            HistoryEntry::Delta { t, .. } => *t,
        };
        if t > target {
            break;
        }
        if matches!(entry, HistoryEntry::Snapshot { .. }) {
            last_snapshot_idx = Some(i);
        }
    }

    let snapshot_idx = last_snapshot_idx.ok_or("No snapshot found")?;
    let mut restored = match &entries[snapshot_idx] {
        HistoryEntry::Snapshot { c, .. } => c.clone(),
        _ => unreachable!(),
    };

    // スナップショット以降のデルタを適用
    let dmp = diff_match_patch_rs::DiffMatchPatch::new();
    for entry in &entries[snapshot_idx + 1..] {
        let t = match entry {
            HistoryEntry::Delta { t, .. } => *t,
            HistoryEntry::Snapshot { t, .. } => *t,
        };
        if t > target {
            break;
        }
        match entry {
            HistoryEntry::Delta { d, .. } => {
                match dmp.diff_from_delta::<diff_match_patch_rs::Compat>(&restored, d) {
                    Ok(diffs) => {
                        restored = diff_match_patch_rs::DiffMatchPatch::diff_text_new(&diffs)
                            .into_iter()
                            .collect();
                    }
                    Err(e) => {
                        eprintln!("tsumugi: history restore delta error: {:?}", e);
                        continue;
                    }
                }
            }
            HistoryEntry::Snapshot { c, .. } => {
                restored = c.clone();
            }
        }
    }

    Ok(restored)
}

/// 履歴ファイル一覧を取得
pub fn get_history_files() -> Vec<HistoryFileMeta> {
    let dir = storage_dir();
    if !dir.exists() {
        return vec![];
    }

    let mut result = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(true, |e| e != "jsonl") {
                continue;
            }

            let file_hash = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            if let Ok(content) = std::fs::read_to_string(&path) {
                let mut file_path = String::new();
                let mut entry_count = 0;
                let mut last_timestamp = 0u64;
                let mut has_unsaved = false;

                for line in content.lines() {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if let Ok(entry) = serde_json::from_str::<HistoryEntry>(line) {
                        entry_count += 1;
                        match &entry {
                            HistoryEntry::Snapshot { t, p, saved, .. } => {
                                if file_path.is_empty() {
                                    file_path = p.clone();
                                }
                                if *t > last_timestamp {
                                    last_timestamp = *t;
                                }
                                has_unsaved = !saved;
                            }
                            HistoryEntry::Delta { t, p, saved, .. } => {
                                if file_path.is_empty() {
                                    file_path = p.clone();
                                }
                                if *t > last_timestamp {
                                    last_timestamp = *t;
                                }
                                has_unsaved = !saved;
                            }
                        }
                    }
                }

                if entry_count > 0 {
                    result.push(HistoryFileMeta {
                        file_hash,
                        file_path,
                        entry_count,
                        last_timestamp,
                        has_unsaved,
                    });
                }
            }
        }
    }

    // 最終タイムスタンプの降順でソート
    result.sort_by(|a, b| b.last_timestamp.cmp(&a.last_timestamp));
    result
}

/// 対象ファイルの最終エントリが未保存かチェック
pub fn check_unsaved_history(file_path: &str) -> bool {
    let hash = path_hash(file_path);
    let path = history_file_path(&hash);
    if !path.exists() {
        return false;
    }

    if let Ok(content) = std::fs::read_to_string(&path) {
        for line in content.lines().rev() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(entry) = serde_json::from_str::<HistoryEntry>(line) {
                return match entry {
                    HistoryEntry::Snapshot { saved, .. } => !saved,
                    HistoryEntry::Delta { saved, .. } => !saved,
                };
            }
        }
    }
    false
}

/// 古いエントリをクリーンアップ
pub fn cleanup_old_entries() {
    let dir = storage_dir();
    if !dir.exists() {
        return;
    }

    let cutoff = now_secs().saturating_sub(CLEANUP_MAX_AGE_SECS);

    if let Ok(dir_entries) = std::fs::read_dir(&dir) {
        for entry in dir_entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(true, |e| e != "jsonl") {
                continue;
            }

            if let Ok(content) = std::fs::read_to_string(&path) {
                let lines: Vec<&str> = content.lines().collect();
                let mut keep_lines = Vec::new();
                let mut found_recent_snapshot = false;

                for line in &lines {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if let Ok(entry) = serde_json::from_str::<HistoryEntry>(line) {
                        let t = match &entry {
                            HistoryEntry::Snapshot { t, .. } => *t,
                            HistoryEntry::Delta { t, .. } => *t,
                        };
                        if t >= cutoff {
                            keep_lines.push(*line);
                            if matches!(entry, HistoryEntry::Snapshot { .. }) {
                                found_recent_snapshot = true;
                            }
                        } else if matches!(entry, HistoryEntry::Snapshot { .. })
                            && !found_recent_snapshot
                        {
                            // ベーススナップショットは保持
                            keep_lines.push(*line);
                        }
                    }
                }

                if keep_lines.len() < lines.len() {
                    if keep_lines.is_empty() {
                        std::fs::remove_file(&path).ok();
                    } else {
                        let new_content = keep_lines.join("\n") + "\n";
                        std::fs::write(&path, new_content).ok();
                    }
                }
            }
        }
    }
}

/// 履歴ファイルを削除
pub fn delete_history_file(file_hash: &str) -> Result<(), String> {
    let path = history_file_path(file_hash);
    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete: {}", e))
}

// --- ヘルパー ---

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn storage_dir() -> PathBuf {
    let base = if cfg!(target_os = "macos") {
        dirs::config_dir().unwrap_or_else(|| PathBuf::from("."))
    } else if cfg!(target_os = "windows") {
        dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))
    } else {
        dirs::config_dir().unwrap_or_else(|| PathBuf::from("."))
    };
    base.join("tsumugi").join("history")
}

fn config_path() -> PathBuf {
    let base = if cfg!(target_os = "macos") {
        dirs::config_dir().unwrap_or_else(|| PathBuf::from("."))
    } else if cfg!(target_os = "windows") {
        dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))
    } else {
        dirs::config_dir().unwrap_or_else(|| PathBuf::from("."))
    };
    base.join("tsumugi").join("history_config.json")
}

fn history_file_path(file_hash: &str) -> PathBuf {
    storage_dir().join(format!("{}.jsonl", file_hash))
}

/// パスのSipHashを計算（lib.rs:file_to_id と同じ方式）
pub fn path_hash(path: &str) -> String {
    let canonical =
        dunce::canonicalize(path).unwrap_or_else(|_| std::path::PathBuf::from(path));
    let path_str = canonical.to_string_lossy();
    let mut hasher = DefaultHasher::new();
    Hasher::write(&mut hasher, path_str.as_bytes());
    let hash = Hasher::finish(&hasher);
    format!("{:016x}", hash)
}

fn is_network_path(path: &str) -> bool {
    path.starts_with("\\\\")
        || path.starts_with("//")
        || path.starts_with("\\\\?\\UNC\\")
        || path.starts_with("/Volumes/")
}

fn append_entry(file_hash: &str, entry: &HistoryEntry) {
    let path = history_file_path(file_hash);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    if let Ok(json) = serde_json::to_string(entry) {
        use std::io::Write;
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            writeln!(file, "{}", json).ok();
        }
    }
}
