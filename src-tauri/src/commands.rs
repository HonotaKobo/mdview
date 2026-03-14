use std::collections::HashMap;
use tauri::command;

use crate::i18n::I18n;
use crate::state::AppState;

#[command]
pub fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

#[command]
pub fn save_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[command]
pub fn notify_saved(path: String, state: tauri::State<'_, AppState>) {
    let mut state = state.lock().unwrap();
    state.saved_path = Some(path);
    state.dirty = false;
}

#[command]
pub fn get_saved_path(state: tauri::State<'_, AppState>) -> Option<String> {
    let state = state.lock().unwrap();
    state.saved_path.clone()
}

#[command]
pub fn get_initial_content(state: tauri::State<'_, AppState>) -> (String, String, bool) {
    let state = state.lock().unwrap();
    (state.current_content.clone(), state.title.clone(), state.content_explicitly_set)
}

#[command]
pub fn rename_file(old_path: String, new_path: String, state: tauri::State<'_, AppState>) -> Result<String, String> {
    std::fs::rename(&old_path, &new_path)
        .map_err(|e| format!("Failed to rename: {}", e))?;
    let abs_path = std::fs::canonicalize(&new_path)
        .unwrap_or_else(|_| std::path::PathBuf::from(&new_path));
    let abs_path_str = abs_path.to_string_lossy().to_string();
    let mut state = state.lock().unwrap();
    state.saved_path = Some(abs_path_str.clone());
    let title = abs_path
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".to_string());
    state.title = title;
    Ok(abs_path_str)
}

#[command]
pub fn get_translations(i18n: tauri::State<'_, I18n>) -> HashMap<String, String> {
    i18n.flat_map()
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
pub fn open_new_window(file: Option<String>) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut args: Vec<String> = vec![];
    if let Some(ref f) = file {
        args.push(f.clone());
    } else {
        // Pass empty body so the new window shows an empty editable view
        args.push("--body".to_string());
        args.push(String::new());
    }
    std::process::Command::new(exe)
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::inherit())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
