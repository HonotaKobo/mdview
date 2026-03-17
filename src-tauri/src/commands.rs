use std::collections::HashMap;
use tauri::command;

use crate::i18n::I18nState;
use crate::recent::{RecentEntry, RecentState};
use crate::state::{WindowMode, WindowStates};
use crate::tags::{TagEntry, TagState};
use crate::update_checker::{UpdateInfo, UpdateResult};

/// Validate and normalize a file path, blocking access to sensitive system directories.
fn validate_path(path: &str) -> Result<std::path::PathBuf, String> {
    if path.contains('\0') {
        return Err("Invalid path".to_string());
    }
    let p = std::path::Path::new(path);

    // Resolve to canonical path (resolves symlinks, .., etc.)
    let canonical = std::fs::canonicalize(p).or_else(|_| {
        // For new files: canonicalize parent directory
        p.parent()
            .ok_or_else(|| "Invalid path".to_string())
            .and_then(|parent| {
                std::fs::canonicalize(parent).map_err(|e| format!("Invalid path: {}", e))
            })
            .map(|cp| cp.join(p.file_name().unwrap_or_default()))
    })?;

    // Block sensitive system directories
    let path_str = canonical.to_string_lossy();
    let blocked: &[&str] = if cfg!(target_os = "windows") {
        &["C:\\Windows", "C:\\Program Files"]
    } else {
        &["/etc", "/usr", "/bin", "/sbin", "/System"]
    };
    for prefix in blocked {
        if path_str.starts_with(prefix) {
            return Err(format!("Access denied: {}", prefix));
        }
    }
    Ok(canonical)
}

#[command]
pub fn read_file(path: String) -> Result<String, String> {
    let path = validate_path(&path)?.to_string_lossy().to_string();
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

#[command]
pub fn save_file(path: String, content: String) -> Result<(), String> {
    let path = validate_path(&path)?.to_string_lossy().to_string();
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[command]
pub fn notify_saved(
    path: String,
    window: tauri::Window,
    states: tauri::State<'_, WindowStates>,
    recent: tauri::State<'_, RecentState>,
) {
    let mut states = states.lock().unwrap();
    if let Some(state) = states.get_mut(window.label()) {
        state.saved_path = Some(path.clone());
        state.dirty = false;
    }
    // Track in recent files
    let title = std::path::Path::new(&path)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".to_string());
    let mut store = recent.lock().unwrap();
    store.add(&path, &title);
}

#[command]
pub fn get_saved_path(window: tauri::Window, states: tauri::State<'_, WindowStates>) -> Option<String> {
    let states = states.lock().unwrap();
    states.get(window.label()).and_then(|s| s.saved_path.clone())
}

#[command]
pub fn sync_content(content: String, window: tauri::Window, states: tauri::State<'_, WindowStates>) {
    let mut states = states.lock().unwrap();
    if let Some(state) = states.get_mut(window.label()) {
        state.current_content = content;
        state.dirty = true;
    }
}

#[command]
pub fn get_initial_content(window: tauri::Window, states: tauri::State<'_, WindowStates>) -> (String, String, bool) {
    let states = states.lock().unwrap();
    if let Some(state) = states.get(window.label()) {
        (state.current_content.clone(), state.title.clone(), state.content_explicitly_set)
    } else {
        (String::new(), "Untitled".to_string(), false)
    }
}

#[command]
pub fn rename_file(old_path: String, new_path: String, window: tauri::Window, states: tauri::State<'_, WindowStates>) -> Result<String, String> {
    let old_path = validate_path(&old_path)?.to_string_lossy().to_string();
    let new_path = validate_path(&new_path)?.to_string_lossy().to_string();
    std::fs::rename(&old_path, &new_path)
        .map_err(|e| format!("Failed to rename: {}", e))?;
    let abs_path = std::fs::canonicalize(&new_path)
        .unwrap_or_else(|_| std::path::PathBuf::from(&new_path));
    let abs_path_str = crate::normalize_path(&abs_path.to_string_lossy());
    let mut states = states.lock().unwrap();
    if let Some(state) = states.get_mut(window.label()) {
        state.saved_path = Some(abs_path_str.clone());
        let title = abs_path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| "Untitled".to_string());
        state.title = title;
    }
    Ok(abs_path_str)
}

#[command]
pub fn save_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    let path = validate_path(&path)?.to_string_lossy().to_string();
    std::fs::write(&path, &data).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[command]
pub fn get_translations(i18n: tauri::State<'_, I18nState>) -> HashMap<String, String> {
    let i18n = i18n.lock().unwrap();
    i18n.flat_map()
}

#[command]
pub fn get_custom_locale_path() -> String {
    crate::i18n::custom_locale_path().to_string_lossy().to_string()
}

#[command]
pub fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[command]
pub fn execute_menu_action(id: String, app: tauri::AppHandle) {
    crate::menu::execute_action(&app, &id);
}

#[command]
pub async fn open_new_window(
    file: Option<String>,
    body: Option<String>,
    close_self: Option<bool>,
    window: tauri::Window,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let close = close_self.unwrap_or(false);
    let app_clone = app.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::open_document_window(&app_clone, file, body, None)
    })
    .await
    .map_err(|e| format!("spawn_blocking failed: {}", e))?;

    result.map(|_| ())?;

    if close {
        let _ = window.destroy();
    }

    Ok(())
}

#[command]
pub fn tag_add(path: String, tag: String, state: tauri::State<'_, TagState>) {
    let mut store = state.lock().unwrap();
    store.add_tag(&path, &tag);
}

#[command]
pub fn tag_remove(path: String, tag: String, state: tauri::State<'_, TagState>) {
    let mut store = state.lock().unwrap();
    store.remove_tag(&path, &tag);
}

#[command]
pub fn tag_set(path: String, tags: Vec<String>, state: tauri::State<'_, TagState>) {
    let mut store = state.lock().unwrap();
    store.set_tags(&path, tags);
}

#[command]
pub fn tag_get(path: String, state: tauri::State<'_, TagState>) -> Vec<String> {
    let store = state.lock().unwrap();
    store.get_tags(&path)
}

#[command]
pub fn tag_get_all(state: tauri::State<'_, TagState>) -> Vec<TagEntry> {
    let mut store = state.lock().unwrap();
    store.reload();
    store.get_all_entries()
}

#[command]
pub fn tag_delete_entry(path: String, state: tauri::State<'_, TagState>) {
    let mut store = state.lock().unwrap();
    store.delete_entry(&path);
}

#[command]
pub fn tag_relink(old_path: String, new_path: String, state: tauri::State<'_, TagState>) {
    let mut store = state.lock().unwrap();
    store.relink(&old_path, &new_path);
}

#[command]
pub fn tag_set_memo(path: String, memo: Option<String>, state: tauri::State<'_, TagState>) {
    let mut store = state.lock().unwrap();
    store.set_memo(&path, memo);
}

#[command]
pub fn check_for_updates() -> Result<UpdateInfo, String> {
    crate::update_checker::check_update()
}

#[command]
pub fn perform_update() -> UpdateResult {
    crate::update_checker::perform_update()
}

#[command]
pub fn restart_app(app: tauri::AppHandle, states: tauri::State<'_, WindowStates>) {
    // Clean up primary socket
    let primary_path = crate::ipc::instance_file("tsumugi-primary");
    std::fs::remove_file(&primary_path).ok();

    // Clean up per-window sockets and HTTP port files
    {
        let states = states.lock().unwrap();
        for (_, state) in states.iter() {
            let path = crate::ipc::instance_file(&state.instance_id);
            std::fs::remove_file(&path).ok();
            std::fs::remove_file(path.with_extension("http")).ok();
        }
    }

    let exe = std::env::current_exe().ok();
    if let Some(exe) = exe {
        let _ = std::process::Command::new(exe)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::inherit())
            .spawn();
    }
    app.exit(0);
}

#[command]
pub fn tag_validate_paths(state: tauri::State<'_, TagState>) -> Vec<(String, bool)> {
    let mut store = state.lock().unwrap();
    store.reload();
    store.validate_paths()
}

#[command]
pub fn tag_get_all_unique_tags(state: tauri::State<'_, TagState>) -> Vec<String> {
    let mut store = state.lock().unwrap();
    store.reload();
    store.get_all_unique_tags()
}

#[command]
pub fn tag_batch_add(paths: Vec<String>, tag: String, state: tauri::State<'_, TagState>) {
    let mut store = state.lock().unwrap();
    store.batch_add(&paths, &tag);
}

#[command]
pub fn tag_rename_all(old_name: String, new_name: String, state: tauri::State<'_, TagState>) {
    let mut store = state.lock().unwrap();
    store.rename_all(&old_name, &new_name);
}

#[command]
pub fn tag_remove_all(tag_name: String, state: tauri::State<'_, TagState>) {
    let mut store = state.lock().unwrap();
    store.remove_all(&tag_name);
}

#[command]
pub fn tag_get_counts(state: tauri::State<'_, TagState>) -> Vec<(String, usize)> {
    let mut store = state.lock().unwrap();
    store.reload();
    store.get_counts()
}

// --- Recent files ---

#[command]
pub fn recent_get_all(state: tauri::State<'_, RecentState>) -> Vec<RecentEntry> {
    let store = state.lock().unwrap();
    store.get_all()
}

#[command]
pub fn recent_add(path: String, title: String, state: tauri::State<'_, RecentState>) {
    let mut store = state.lock().unwrap();
    store.add(&path, &title);
}

#[command]
pub fn recent_remove(path: String, state: tauri::State<'_, RecentState>) {
    let mut store = state.lock().unwrap();
    store.remove(&path);
}

#[command]
pub fn recent_clear(state: tauri::State<'_, RecentState>) {
    let mut store = state.lock().unwrap();
    store.clear();
}

// --- Window mode ---

#[command]
pub fn get_window_mode(window: tauri::Window, states: tauri::State<'_, WindowStates>) -> String {
    let states = states.lock().unwrap();
    if let Some(state) = states.get(window.label()) {
        match state.window_mode {
            WindowMode::Home => "home".to_string(),
            WindowMode::Editor => "editor".to_string(),
        }
    } else {
        "editor".to_string()
    }
}
