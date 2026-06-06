use rusqlite::{Connection, Result as SqliteResult};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub struct Database {
    pub conn: Connection,
    pub data_dir: PathBuf,
    pub media_root: PathBuf,
}

impl Database {
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));

        // 确保目录存在
        fs::create_dir_all(&data_dir)?;

        let db_path = data_dir.join("opentu.db");
        let conn = Connection::open(&db_path)?;

        // 启用 WAL 模式
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;

        let mut db = Database {
            conn,
            data_dir: data_dir.clone(),
            media_root: data_dir.join("media"),
        };
        db.init_schema()?;

        // 从 settings 表中读取自定义路径
        let custom_root: Option<String> = db
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'media_root_path'",
                [],
                |row| row.get(0),
            )
            .ok()
            .flatten();

        if let Some(custom_path) = custom_root {
            let custom = PathBuf::from(&custom_path);
            if custom.exists() || fs::create_dir_all(&custom).is_ok() {
                db.media_root = custom;
            }
        }

        // 确保媒体子目录存在
        db.ensure_media_dirs()?;
        fs::create_dir_all(data_dir.join("backups"))?;
        fs::create_dir_all(data_dir.join("exports"))?;
        fs::create_dir_all(data_dir.join("logs"))?;

        Ok(db)
    }

    pub fn ensure_media_dirs(&self) -> Result<(), Box<dyn std::error::Error>> {
        fs::create_dir_all(self.media_root.join("图片"))?;
        fs::create_dir_all(self.media_root.join("视频"))?;
        fs::create_dir_all(self.media_root.join("音频"))?;
        Ok(())
    }

    pub fn set_media_root(&mut self, path: PathBuf) -> Result<(), Box<dyn std::error::Error>> {
        fs::create_dir_all(&path)?;
        self.media_root = path.clone();

        // 持久化到 settings 表
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('media_root_path', ?1, strftime('%s','now'))",
            rusqlite::params![path.to_string_lossy().to_string()],
        )?;

        // 确保子目录存在
        self.ensure_media_dirs()?;
        Ok(())
    }

    pub fn reset_media_root(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let default_root = self.data_dir.join("media");
        self.set_media_root(default_root)
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