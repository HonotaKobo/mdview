use tauri::command;

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
pub fn get_initial_content(state: tauri::State<'_, AppState>) -> (String, String) {
    let state = state.lock().unwrap();
    (state.current_content.clone(), state.title.clone())
}
