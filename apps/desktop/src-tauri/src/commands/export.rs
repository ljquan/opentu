use crate::AppState;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn show_save_dialog(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    default_name: Option<String>,
) -> Result<Option<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let default_path = db
        .data_dir
        .join("exports")
        .join(default_name.unwrap_or_else(|| "export".to_string()));

    let file_path = app
        .dialog()
        .file()
        .add_filter("ZIP", &["zip"])
        .add_filter("JSON", &["json"])
        .add_filter("PNG", &["png"])
        .add_filter("All", &["*"])
        .set_file_name(default_path.to_string_lossy().to_string())
        .blocking_save_file();

    Ok(file_path.map(|p| p.to_string()))
}