use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::Hasher;
use std::path::PathBuf;
use std::sync::Mutex;

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

/// 履歴エントリのメタ情報（一覧表示用）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HistoryEntryMeta {
    pub entry_type: String,
    pub timestamp: u64,
    pub file_path: String,
    pub saved: bool,
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

/// インデックスエントリ（メタ情報のJSON管理用）
#[derive(Debug, Serialize, Deserialize, Clone)]
struct IndexEntry {
    file_path: String,
    entry_count: usize,
    last_timestamp: u64,
    has_unsaved: bool,
}

/// ファイルごとの追跡状態
struct FileTracker {
    last_recorded_content: String,
    delta_count_since_snapshot: u32,
    file_hash: String,
    file_path: Option<String>,
    has_initial_snapshot: bool,
}

/// 履歴ストア
pub struct HistoryStore {
    config: HistoryConfig,
    trackers: HashMap<String, FileTracker>,
    index: HashMap<String, IndexEntry>,
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

        // インデックスを読み込み。なければJSONLからビルド
        let idx_path = index_path();
        let index = if idx_path.exists() {
            std::fs::read_to_string(&idx_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_else(build_index_from_jsonl)
        } else {
            let idx = build_index_from_jsonl();
            if !idx.is_empty() {
                save_index_to_disk(&idx);
            }
            idx
        };

        Self {
            config,
            trackers: HashMap::new(),
            index,
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

    fn save_index(&self) {
        save_index_to_disk(&self.index);
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

        // 既存インデックスの has_unsaved をリセット（ディスクから読み込んだ状態）
        if file_path.is_some() {
            if let Some(idx_entry) = self.index.get_mut(&hash) {
                if idx_entry.has_unsaved {
                    idx_entry.has_unsaved = false;
                    self.save_index();
                }
            }
        }

        // 履歴から最新の状態を取得し、初回スナップショットが必要か判定
        let (has_initial, delta_count) = match get_last_state(&hash) {
            Some((last_state, dc)) if last_state == initial_content => (true, dc),
            _ => (false, 0),
        };

        self.trackers.insert(
            label.to_string(),
            FileTracker {
                last_recorded_content: initial_content.to_string(),
                delta_count_since_snapshot: delta_count,
                file_hash: hash,
                file_path: file_path.map(|s| s.to_string()),
                has_initial_snapshot: has_initial,
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

        // トラッカーから必要な値をコピー（借用競合を回避）
        let (file_hash, last_content, delta_count, has_initial_snapshot) =
            match self.trackers.get(label) {
                Some(t) => (
                    t.file_hash.clone(),
                    t.last_recorded_content.clone(),
                    t.delta_count_since_snapshot,
                    t.has_initial_snapshot,
                ),
                None => return,
            };

        let now = now_secs();

        // 初回スナップショットが未記録の場合
        if !has_initial_snapshot {
            if content.is_empty() && last_content.is_empty() {
                return; // 空→空: 何もしない
            }

            let fp_str = saved_path.unwrap_or("").to_string();

            if last_content.is_empty() {
                // 新規ファイル（空→非空）: content でスナップショット、return
                let entry = HistoryEntry::Snapshot {
                    t: now,
                    p: fp_str.clone(),
                    c: content.to_string(),
                    saved: is_saved,
                };
                append_entry(&file_hash, &entry);

                let idx_entry = self
                    .index
                    .entry(file_hash.clone())
                    .or_insert(IndexEntry {
                        file_path: fp_str.clone(),
                        entry_count: 0,
                        last_timestamp: 0,
                        has_unsaved: false,
                    });
                if !fp_str.is_empty() {
                    idx_entry.file_path = fp_str;
                }
                idx_entry.entry_count += 1;
                idx_entry.last_timestamp = now;
                idx_entry.has_unsaved = !is_saved;
                self.save_index();

                if let Some(tracker) = self.trackers.get_mut(label) {
                    tracker.has_initial_snapshot = true;
                    tracker.last_recorded_content = content.to_string();
                }
                return;
            } else {
                // 既存ファイル初回編集: last_content でスナップショット → return せずデルタ処理へ
                let entry = HistoryEntry::Snapshot {
                    t: now,
                    p: fp_str.clone(),
                    c: last_content.clone(),
                    saved: true,
                };
                append_entry(&file_hash, &entry);

                let idx_entry = self
                    .index
                    .entry(file_hash.clone())
                    .or_insert(IndexEntry {
                        file_path: fp_str.clone(),
                        entry_count: 0,
                        last_timestamp: 0,
                        has_unsaved: false,
                    });
                if !fp_str.is_empty() {
                    idx_entry.file_path = fp_str;
                }
                idx_entry.entry_count += 1;
                idx_entry.last_timestamp = now;
                self.save_index();

                if let Some(tracker) = self.trackers.get_mut(label) {
                    tracker.has_initial_snapshot = true;
                }
                // return しない → 以下のデルタ計算に進む
            }
        }

        // 変更なしチェック
        if content == last_content {
            if !is_saved {
                return;
            }
            // 保存イベント: スナップショットを記録
            let path_str = saved_path.unwrap_or("").to_string();
            let entry = HistoryEntry::Snapshot {
                t: now,
                p: path_str.clone(),
                c: content.to_string(),
                saved: true,
            };
            append_entry(&file_hash, &entry);

            let idx_entry = self
                .index
                .entry(file_hash.clone())
                .or_insert(IndexEntry {
                    file_path: path_str.clone(),
                    entry_count: 0,
                    last_timestamp: 0,
                    has_unsaved: false,
                });
            if !path_str.is_empty() {
                idx_entry.file_path = path_str;
            }
            idx_entry.entry_count += 1;
            idx_entry.last_timestamp = now;
            idx_entry.has_unsaved = false;
            self.save_index();

            if let Some(tracker) = self.trackers.get_mut(label) {
                tracker.delta_count_since_snapshot = 0;
            }
            return;
        }

        // saved_pathが変わった場合（名前を付けて保存した場合等）、ハッシュを更新
        if let Some(fp) = saved_path {
            let new_hash = path_hash(fp);
            if new_hash != file_hash {
                // 新しいファイルとして初回スナップショットを書き込む
                let entry = HistoryEntry::Snapshot {
                    t: now,
                    p: fp.to_string(),
                    c: content.to_string(),
                    saved: is_saved,
                };
                append_entry(&new_hash, &entry);

                // インデックスを更新
                let idx_entry = self
                    .index
                    .entry(new_hash.clone())
                    .or_insert(IndexEntry {
                        file_path: fp.to_string(),
                        entry_count: 0,
                        last_timestamp: 0,
                        has_unsaved: false,
                    });
                idx_entry.file_path = fp.to_string();
                idx_entry.entry_count += 1;
                idx_entry.last_timestamp = now;
                idx_entry.has_unsaved = !is_saved;
                self.save_index();

                if let Some(tracker) = self.trackers.get_mut(label) {
                    tracker.file_hash = new_hash;
                    tracker.file_path = Some(fp.to_string());
                    tracker.last_recorded_content = content.to_string();
                    tracker.delta_count_since_snapshot = 0;
                }
                return;
            }
        }

        // 差分を計算
        let path_str = saved_path.unwrap_or("").to_string();
        let dmp = diff_match_patch_rs::DiffMatchPatch::new();
        match dmp.diff_main::<diff_match_patch_rs::Compat>(&last_content, content) {
            Ok(diffs) => {
                match dmp.diff_to_delta(&diffs) {
                    Ok(delta) => {
                        let entry = HistoryEntry::Delta {
                            t: now,
                            p: path_str.clone(),
                            d: delta,
                            saved: is_saved,
                        };
                        append_entry(&file_hash, &entry);
                        let new_delta_count = delta_count + 1;

                        // スナップショット間隔に達した場合、または保存時
                        let wrote_snapshot = if new_delta_count >= snapshot_interval || is_saved {
                            let snapshot = HistoryEntry::Snapshot {
                                t: now,
                                p: path_str.clone(),
                                c: content.to_string(),
                                saved: is_saved,
                            };
                            append_entry(&file_hash, &snapshot);
                            true
                        } else {
                            false
                        };

                        // インデックスを更新（delta + スナップショット分をまとめて）
                        let added = if wrote_snapshot { 2 } else { 1 };
                        let idx_entry = self
                            .index
                            .entry(file_hash.clone())
                            .or_insert(IndexEntry {
                                file_path: path_str.clone(),
                                entry_count: 0,
                                last_timestamp: 0,
                                has_unsaved: false,
                            });
                        if !path_str.is_empty() {
                            idx_entry.file_path = path_str;
                        }
                        idx_entry.entry_count += added;
                        idx_entry.last_timestamp = now;
                        idx_entry.has_unsaved = !is_saved;
                        self.save_index();

                        // トラッカーを更新
                        if let Some(tracker) = self.trackers.get_mut(label) {
                            tracker.delta_count_since_snapshot = if wrote_snapshot {
                                0
                            } else {
                                new_delta_count
                            };
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

        if let Some(tracker) = self.trackers.get_mut(label) {
            tracker.last_recorded_content = content.to_string();
        }
    }

    /// 対象ファイルの未保存チェック（インデックスから取得）
    pub fn check_unsaved(&self, file_path: &str) -> bool {
        let hash = path_hash(file_path);
        self.index.get(&hash).map_or(false, |e| e.has_unsaved)
    }

    /// 履歴ファイル一覧をインデックスから取得
    pub fn get_files(&self) -> Vec<HistoryFileMeta> {
        let mut result: Vec<HistoryFileMeta> = self
            .index
            .iter()
            .map(|(hash, entry)| HistoryFileMeta {
                file_hash: hash.clone(),
                file_path: entry.file_path.clone(),
                entry_count: entry.entry_count,
                last_timestamp: entry.last_timestamp,
                has_unsaved: entry.has_unsaved,
            })
            .collect();
        // 最終タイムスタンプの降順でソート
        result.sort_by(|a, b| b.last_timestamp.cmp(&a.last_timestamp));
        result
    }

    /// 履歴ファイルを削除
    pub fn delete_file(&mut self, file_hash: &str) -> Result<(), String> {
        let path = history_file_path(file_hash);
        std::fs::remove_file(&path).map_err(|e| format!("Failed to delete: {}", e))?;
        self.index.remove(file_hash);
        self.save_index();
        Ok(())
    }

    /// 古いエントリをクリーンアップ
    pub fn cleanup_old_entries(&mut self) {
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

                let file_hash = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();

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
                            self.index.remove(&file_hash);
                        } else {
                            let new_content = keep_lines.join("\n") + "\n";
                            std::fs::write(&path, new_content).ok();
                            // インデックスのentry_countを更新
                            if let Some(idx_entry) = self.index.get_mut(&file_hash) {
                                idx_entry.entry_count = keep_lines.len();
                            }
                        }
                    }
                }
            }
        }

        self.save_index();
    }
}

// --- 独立関数 ---

/// 指定ファイルハッシュのエントリ一覧を取得する
pub fn get_entries(file_hash: &str) -> Result<Vec<HistoryEntryMeta>, String> {
    let path = history_file_path(file_hash);
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read history: {}", e))?;

    let mut result = Vec::new();
    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<HistoryEntry>(line) {
            let meta = match &entry {
                HistoryEntry::Snapshot { t, p, saved, .. } => HistoryEntryMeta {
                    entry_type: "snapshot".to_string(),
                    timestamp: *t,
                    file_path: p.clone(),
                    saved: *saved,
                },
                HistoryEntry::Delta { t, p, saved, .. } => HistoryEntryMeta {
                    entry_type: "delta".to_string(),
                    timestamp: *t,
                    file_path: p.clone(),
                    saved: *saved,
                },
            };
            result.push(meta);
        }
    }

    // 新しい順にソート
    result.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(result)
}

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

/// 履歴ファイルから最新の状態と最後のスナップショットからのデルタ数を取得
fn get_last_state(file_hash: &str) -> Option<(String, u32)> {
    let path = history_file_path(file_hash);
    let raw = std::fs::read_to_string(&path).ok()?;

    let mut current: Option<String> = None;
    let mut delta_count: u32 = 0;
    let dmp = diff_match_patch_rs::DiffMatchPatch::new();

    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<HistoryEntry>(line) {
            match entry {
                HistoryEntry::Snapshot { c, .. } => {
                    current = Some(c);
                    delta_count = 0;
                }
                HistoryEntry::Delta { d, .. } => {
                    if let Some(ref cur) = current {
                        if let Ok(diffs) =
                            dmp.diff_from_delta::<diff_match_patch_rs::Compat>(cur, &d)
                        {
                            current = Some(
                                diff_match_patch_rs::DiffMatchPatch::diff_text_new(&diffs)
                                    .into_iter()
                                    .collect(),
                            );
                            delta_count += 1;
                        }
                    }
                }
            }
        }
    }

    current.map(|c| (c, delta_count))
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

fn index_path() -> PathBuf {
    storage_dir().join("index.json")
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

fn save_index_to_disk(index: &HashMap<String, IndexEntry>) {
    let path = index_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    if let Ok(json) = serde_json::to_string(index) {
        std::fs::write(&path, json).ok();
    }
}

/// JSONLファイルからインデックスをビルド（初回マイグレーション用）
fn build_index_from_jsonl() -> HashMap<String, IndexEntry> {
    let dir = storage_dir();
    if !dir.exists() {
        return HashMap::new();
    }

    let mut index = HashMap::new();
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
                    if let Ok(he) = serde_json::from_str::<HistoryEntry>(line) {
                        entry_count += 1;
                        match &he {
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
                    index.insert(
                        file_hash,
                        IndexEntry {
                            file_path,
                            entry_count,
                            last_timestamp,
                            has_unsaved,
                        },
                    );
                }
            }
        }
    }

    index
}
