use rusqlite::{Connection, Result as SqliteResult};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

pub struct Database {
    pub conn: Connection,
    pub data_dir: PathBuf,
}

impl Database {
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));

        // 确保目录存在
        fs::create_dir_all(&data_dir)?;
        fs::create_dir_all(data_dir.join("media").join("images"))?;
        fs::create_dir_all(data_dir.join("media").join("videos"))?;
        fs::create_dir_all(data_dir.join("media").join("audio"))?;
        fs::create_dir_all(data_dir.join("backups"))?;
        fs::create_dir_all(data_dir.join("exports"))?;
        fs::create_dir_all(data_dir.join("logs"))?;

        let db_path = data_dir.join("opentu.db");
        let conn = Connection::open(&db_path)?;

        // 启用 WAL 模式
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;

        let db = Database { conn, data_dir };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> SqliteResult<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS workspaces (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                data       TEXT NOT NULL,
                thumbnail  TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS assets (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                type       TEXT NOT NULL,
                mime_type  TEXT,
                local_path TEXT NOT NULL,
                file_size  INTEGER NOT NULL DEFAULT 0,
                width      INTEGER,
                height     INTEGER,
                duration   REAL,
                metadata   TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id           TEXT PRIMARY KEY,
                type         TEXT NOT NULL,
                status       TEXT NOT NULL DEFAULT 'pending',
                params       TEXT,
                result       TEXT,
                error        TEXT,
                created_at   INTEGER NOT NULL,
                completed_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS knowledge_notes (
                id         TEXT PRIMARY KEY,
                title      TEXT NOT NULL,
                content    TEXT NOT NULL,
                tags       TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chat_history (
                id              TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role            TEXT NOT NULL,
                content         TEXT NOT NULL,
                created_at      INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_assets_type    ON assets(type);
            CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at);
            CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_notes_updated  ON knowledge_notes(updated_at);
            ",
        )?;
        Ok(())
    }
}