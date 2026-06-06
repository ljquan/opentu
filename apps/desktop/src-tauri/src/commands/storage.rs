use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn get_local(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .conn
        .prepare("SELECT value FROM settings WHERE key = ?1")
        .map_err(|e| e.to_string())?;
    let result: Option<String> = stmt
        .query_row([&key], |row| row.get(0))
        .ok()
        .flatten();
    Ok(result)
}

#[tauri::command]
pub fn set_local(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.conn
        .execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?1, ?2, strftime('%s','now'))",
            rusqlite::params![key, value],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn remove_local(state: State<AppState>, key: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.conn
        .execute("DELETE FROM settings WHERE key = ?1", [key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_stats(state: State<AppState>) -> Result<serde_json::Value, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let data_dir = db.data_dir.clone();
    let media_root = db.media_root.clone();

    let db_size = std::fs::metadata(data_dir.join("opentu.db"))
        .map(|m| m.len())
        .unwrap_or(0);

    let media_size = dir_size(&media_root);

    Ok(serde_json::json!({
        "dbSize": db_size,
        "mediaSize": media_size,
        "totalSize": db_size + media_size,
        "dataDir": data_dir.to_string_lossy(),
        "mediaRoot": media_root.to_string_lossy(),
    }))
}

fn dir_size(path: &std::path::Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                total += dir_size(&path);
            } else if let Ok(meta) = path.metadata() {
                total += meta.len();
            }
        }
    }
    total
}