mod database;
mod commands;

use database::Database;
use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<Database>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let db = Database::new(app.handle())?;
            app.manage(AppState {
                db: Mutex::new(db),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::storage::get_local,
            commands::storage::set_local,
            commands::storage::remove_local,
            commands::storage::get_stats,
            commands::media::save_file,
            commands::media::get_file_path,
            commands::media::delete_file,
            commands::media::get_media_dir,
            commands::export::show_save_dialog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}