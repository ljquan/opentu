use crate::AppState;
use std::fs;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn save_file(
    state: State<AppState>,
    file_name: String,
    buffer: Vec<u8>,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let media_dir = db.data_dir.join("media").join("images");
    fs::create_dir_all(&media_dir).map_err(|e| e.to_string())?;

    let file_path = media_dir.join(&file_name);
    fs::write(&file_path, &buffer).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_file_path(
    state: State<AppState>,
    file_name: String,
) -> Result<Option<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let file_path = db.data_dir.join("media").join("images").join(&file_name);

    if file_path.exists() {
        Ok(Some(file_path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn delete_file(
    state: State<AppState>,
    file_name: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let file_path = db.data_dir.join("media").join("images").join(&file_name);

    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_media_dir(state: State<AppState>) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let media_dir = db.data_dir.join("media");
    Ok(media_dir.to_string_lossy().to_string())
}