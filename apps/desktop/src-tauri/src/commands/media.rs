use crate::AppState;
use std::fs;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn save_file(
    state: State<AppState>,
    file_name: String,
    buffer: Vec<u8>,
    file_type: Option<String>,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let subdir = get_media_subdir(file_type.as_deref().unwrap_or("image"));
    let media_dir = db.media_root.join(subdir);
    fs::create_dir_all(&media_dir).map_err(|e| e.to_string())?;

    let file_path = media_dir.join(&file_name);
    fs::write(&file_path, &buffer).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_file_path(
    state: State<AppState>,
    file_name: String,
    file_type: Option<String>,
) -> Result<Option<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let subdir = get_media_subdir(file_type.as_deref().unwrap_or("image"));
    let file_path = db.media_root.join(subdir).join(&file_name);

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
    file_type: Option<String>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let subdir = get_media_subdir(file_type.as_deref().unwrap_or("image"));
    let file_path = db.media_root.join(subdir).join(&file_name);

    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_media_dir(state: State<AppState>) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    Ok(db.media_root.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_media_root_path(state: State<AppState>) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    Ok(db.media_root.to_string_lossy().to_string())
}

#[tauri::command]
pub fn set_media_root_path(
    state: State<AppState>,
    path: String,
) -> Result<String, String> {
    let new_path = PathBuf::from(&path);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_media_root(new_path).map_err(|e| e.to_string())?;
    Ok(db.media_root.to_string_lossy().to_string())
}

#[tauri::command]
pub fn reset_media_root_path(state: State<AppState>) -> Result<String, String> {
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    db.reset_media_root().map_err(|e| e.to_string())?;
    Ok(db.media_root.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn pick_media_folder(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let folder_path = app
        .dialog()
        .file()
        .blocking_pick_folder();

    Ok(folder_path.map(|p| p.to_string()))
}

/// 根据文件类型获取对应的子目录名
fn get_media_subdir(file_type: &str) -> &str {
    match file_type {
        "video" => "视频",
        "audio" => "音频",
        _ => "图片",
    }
}