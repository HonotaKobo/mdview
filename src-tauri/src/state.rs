use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Clone, PartialEq)]
pub enum WindowMode {
    Home,
    Editor,
}

pub struct WindowState {
    /// IPC instance ID for this window
    pub instance_id: String,
    /// Current markdown source
    pub current_content: String,
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
    /// Window mode: Home screen or Editor
    pub window_mode: WindowMode,
}

impl WindowState {
    pub fn new(instance_id: String, title: String, content: String) -> Self {
        Self {
            instance_id,
            current_content: content,
            title,
            saved_path: None,
            dirty: false,
            path_disclosure: false,
            content_explicitly_set: false,
            window_mode: WindowMode::Editor,
        }
    }
}

/// Window label → WindowState
pub type WindowStates = Mutex<HashMap<String, WindowState>>;

/// Tracks the last focused document window label
pub type LastFocusedDoc = Mutex<String>;
