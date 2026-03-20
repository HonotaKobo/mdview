use std::collections::HashMap;
use std::sync::Mutex;

pub struct WindowState {
    /// IPC instance ID for this window
    pub instance_id: String,
    /// Current markdown source
    pub current_content: String,
    /// 最後に保存した時点のコンテンツ（dirty判定の基準値）
    pub saved_content: String,
    /// Document title
    pub title: String,
    /// Path where user saved the file (None if unsaved)
    pub saved_path: Option<String>,
    /// Content modified since last save
    pub dirty: bool,
    /// Whether to disclose file path to AI tools (default: false)
    pub path_disclosure: bool,
    /// Whether content was explicitly provided (--body or --file)
    pub content_explicitly_set: bool,
}

impl WindowState {
    pub fn new(instance_id: String, title: String, content: String) -> Self {
        Self {
            instance_id,
            saved_content: content.clone(),
            current_content: content,
            title,
            saved_path: None,
            dirty: false,
            path_disclosure: false,
            content_explicitly_set: false,
        }
    }
}

/// Window label → WindowState
pub type WindowStates = Mutex<HashMap<String, WindowState>>;

/// Tracks the last focused document window label
pub type LastFocusedDoc = Mutex<String>;
