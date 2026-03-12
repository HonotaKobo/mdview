use std::sync::Mutex;

pub type AppState = Mutex<AppStateInner>;

pub struct AppStateInner {
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
}

impl AppStateInner {
    pub fn new(title: String, content: String) -> Self {
        Self {
            current_content: content,
            title,
            saved_path: None,
            dirty: false,
            path_disclosure: false,
        }
    }
}
