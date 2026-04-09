use rusqlite::{Connection, params};
use std::sync::Mutex;

#[cfg(desktop)]
use tauri::{Emitter, Manager};
#[cfg(desktop)]
use tauri::{PhysicalPosition, PhysicalSize};
#[cfg(desktop)]
use serde::Serialize;
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

// ---- DB State ----

struct DbState(Mutex<Connection>);

// ---- Payload types (frontend → Rust) ----

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionPayload {
    id: String,
    color_slot: i64,
    is_open: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoPayload {
    id: String,
    session_id: String,
    content: String,
    title: String,
    pos_x: f64,
    pos_y: f64,
    width: f64,
    height: f64,
    slot_index: Option<i64>,
    is_open: bool,
    is_pinned: bool,
}

// ---- Row types (Rust → frontend) ----

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MemoRow {
    id: String,
    session_id: String,
    content: String,
    title: String,
    pos_x: f64,
    pos_y: f64,
    width: f64,
    height: f64,
    slot_index: Option<i64>,
    is_open: bool,
    is_pinned: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionRow {
    id: String,
    color_slot: i64,
    is_open: bool,
    memos: Vec<MemoRow>,
}

// ---- DB schema init ----

fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;

        CREATE TABLE IF NOT EXISTS sessions (
            id             TEXT PRIMARY KEY,
            color_slot     INTEGER NOT NULL,
            is_open        INTEGER NOT NULL DEFAULT 1,
            created_at     TEXT NOT NULL,
            updated_at     TEXT NOT NULL,
            last_active_at TEXT NOT NULL,
            trashed_at     TEXT
        );

        CREATE TABLE IF NOT EXISTS memos (
            id         TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            content    TEXT NOT NULL DEFAULT '',
            title      TEXT NOT NULL DEFAULT '',
            pos_x      REAL NOT NULL DEFAULT 0,
            pos_y      REAL NOT NULL DEFAULT 0,
            width      REAL NOT NULL DEFAULT 320,
            height     REAL NOT NULL DEFAULT 240,
            slot_index INTEGER,
            is_open    INTEGER NOT NULL DEFAULT 1,
            is_pinned  INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            trashed_at TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        CREATE TABLE IF NOT EXISTS settings (
            id                  INTEGER PRIMARY KEY CHECK (id = 1),
            auto_close_minutes  INTEGER NOT NULL DEFAULT 60,
            max_open_sessions   INTEGER NOT NULL DEFAULT 5,
            max_open_memos      INTEGER NOT NULL DEFAULT 15
        );

        INSERT OR IGNORE INTO settings (id, auto_close_minutes, max_open_sessions, max_open_memos)
        VALUES (1, 60, 5, 15);",
    )
}

// ---- Tauri commands ----

/// 起動時クリーンアップ: is_open 全件リセット → 空メモ/セッションを論理削除
#[tauri::command]
fn startup_cleanup(state: tauri::State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute_batch(
        "UPDATE sessions SET is_open = 0;
         UPDATE memos    SET is_open = 0;
         UPDATE memos SET trashed_at = datetime('now'), updated_at = datetime('now')
             WHERE trashed_at IS NULL AND content = '';
         UPDATE sessions SET trashed_at = datetime('now'), updated_at = datetime('now')
             WHERE trashed_at IS NULL
               AND id NOT IN (
                   SELECT DISTINCT session_id FROM memos WHERE trashed_at IS NULL
               );",
    )
    .map_err(|e| e.to_string())
}

/// is_open = 1 のセッションとそのメモを返す
#[tauri::command]
fn load_sessions(state: tauri::State<DbState>) -> Result<Vec<SessionRow>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let mut session_stmt = conn
        .prepare(
            "SELECT id, color_slot, is_open FROM sessions
             WHERE is_open = 1 AND trashed_at IS NULL",
        )
        .map_err(|e| e.to_string())?;

    let session_rows: Vec<(String, i64, bool)> = session_stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get::<_, i64>(2)? != 0))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for (id, color_slot, is_open) in session_rows {
        let mut memo_stmt = conn
            .prepare(
                "SELECT id, session_id, content, title, pos_x, pos_y, width, height,
                        slot_index, is_open, is_pinned
                 FROM memos WHERE session_id = ?1 AND trashed_at IS NULL",
            )
            .map_err(|e| e.to_string())?;

        let memos: Vec<MemoRow> = memo_stmt
            .query_map(params![id], |row| {
                Ok(MemoRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    content: row.get(2)?,
                    title: row.get(3)?,
                    pos_x: row.get(4)?,
                    pos_y: row.get(5)?,
                    width: row.get(6)?,
                    height: row.get(7)?,
                    slot_index: row.get(8)?,
                    is_open: row.get::<_, i64>(9)? != 0,
                    is_pinned: row.get::<_, i64>(10)? != 0,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?;

        result.push(SessionRow {
            id,
            color_slot,
            is_open,
            memos,
        });
    }

    Ok(result)
}

/// セッションを upsert（timestamp は Rust 側で生成）
#[tauri::command]
fn upsert_session(state: tauri::State<DbState>, session: SessionPayload) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO sessions (id, color_slot, is_open, created_at, updated_at, last_active_at)
         VALUES (?1, ?2, ?3, datetime('now'), datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
             color_slot     = excluded.color_slot,
             is_open        = excluded.is_open,
             updated_at     = datetime('now'),
             last_active_at = datetime('now')",
        params![session.id, session.color_slot, session.is_open as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// メモを upsert（timestamp は Rust 側で生成、created_at は保全）
#[tauri::command]
fn upsert_memo(state: tauri::State<DbState>, memo: MemoPayload) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO memos (id, session_id, content, title, pos_x, pos_y, width, height,
                            slot_index, is_open, is_pinned, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
             content    = excluded.content,
             title      = excluded.title,
             pos_x      = excluded.pos_x,
             pos_y      = excluded.pos_y,
             width      = excluded.width,
             height     = excluded.height,
             slot_index = excluded.slot_index,
             is_open    = excluded.is_open,
             is_pinned  = excluded.is_pinned,
             updated_at = datetime('now')",
        params![
            memo.id,
            memo.session_id,
            memo.content,
            memo.title,
            memo.pos_x,
            memo.pos_y,
            memo.width,
            memo.height,
            memo.slot_index,
            memo.is_open as i64,
            memo.is_pinned as i64,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// セッションとその全メモを閉じる（is_open = 0、trashed_at は変えない）
#[tauri::command]
fn close_session(state: tauri::State<DbState>, session_id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE sessions SET is_open = 0, updated_at = datetime('now') WHERE id = ?1",
        params![session_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE memos SET is_open = 0, updated_at = datetime('now') WHERE session_id = ?1",
        params![session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// セッションとその全メモをゴミ箱へ（trashed_at 設定）
#[tauri::command]
fn trash_session(state: tauri::State<DbState>, session_id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE sessions SET is_open = 0, trashed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?1",
        params![session_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE memos SET is_open = 0, trashed_at = datetime('now'), updated_at = datetime('now')
         WHERE session_id = ?1",
        params![session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// メモ単体をゴミ箱へ（trashed_at 設定）
#[tauri::command]
fn trash_memo(state: tauri::State<DbState>, memo_id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE memos SET is_open = 0, trashed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?1",
        params![memo_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn set_overlay_input_mode(
    app: tauri::AppHandle,
    mode: String,
) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let enabled = mode == "pass-through";
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|e| e.to_string())?;
    app.emit("overlay://clickthrough", enabled)
        .map_err(|e| e.to_string())?;
    Ok(enabled)
}

// ---- App entry ----

#[cfg(desktop)]
#[derive(Clone, Copy, Serialize)]
struct PickerOpenPayload;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
    };

    let open_single_session =
        Shortcut::new(Some(Modifiers::SUPER | Modifiers::ALT), Code::Enter);
    let open_session_picker =
        Shortcut::new(Some(Modifiers::SUPER | Modifiers::ALT), Code::KeyN);
    let toggle_clickthrough =
        Shortcut::new(Some(Modifiers::SUPER | Modifiers::ALT), Code::Slash);

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            startup_cleanup,
            load_sessions,
            upsert_session,
            upsert_memo,
            close_session,
            trash_session,
            trash_memo,
            set_overlay_input_mode,
        ])
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler({
                    let open_single_session = open_single_session.clone();
                    let open_session_picker = open_session_picker.clone();
                    let toggle_clickthrough = toggle_clickthrough.clone();
                    move |app, shortcut, event| {
                        if event.state() != ShortcutState::Pressed {
                            return;
                        }

                        let Some(window) = app.get_webview_window("main") else {
                            return;
                        };

                        if shortcut == &open_single_session {
                            let _ = window.set_ignore_cursor_events(false);
                            let _ = app.emit("overlay://clickthrough", false);
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = app.emit("session://open-single", true);
                            return;
                        }

                        if shortcut == &open_session_picker {
                            let _ = window.set_ignore_cursor_events(false);
                            let _ = app.emit("overlay://clickthrough", false);
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = app.emit("session://open-picker", PickerOpenPayload);
                            return;
                        }

                        #[cfg(debug_assertions)]
                        if shortcut == &toggle_clickthrough {
                            let enabled = window
                                .state::<OverlayState>()
                                .toggle_clickthrough()
                                .unwrap_or(false);

                            let _ = window.set_ignore_cursor_events(enabled);
                            let _ = app.emit("overlay://clickthrough", enabled);
                        }
                    }
                })
                .build(),
        )
        .setup({
            let open_single_session = open_single_session.clone();
            let open_session_picker = open_session_picker.clone();
            let toggle_clickthrough = toggle_clickthrough.clone();
            move |app| {
                #[cfg(desktop)]
                {
                    app.manage(OverlayState::default());

                    // DB 初期化
                    let app_data_dir = app.path().app_data_dir()?;
                    std::fs::create_dir_all(&app_data_dir)?;
                    let db_path = app_data_dir.join("sticky.db");
                    let conn = Connection::open(&db_path)
                        .map_err(|e| format!("failed to open db: {e}"))?;
                    init_db(&conn).map_err(|e| format!("failed to init db: {e}"))?;
                    app.manage(DbState(Mutex::new(conn)));

                    // メニューバー構築
                    let menu = Menu::with_items(app, &[
                        &Submenu::with_items(app, "sticky", true, &[
                            &MenuItem::with_id(app, "new-session", "New 1-Note Session", true, None::<&str>)?,
                            &PredefinedMenuItem::separator(app)?,
                            &MenuItem::with_id(app, "open-home", "Open Home", false, None::<&str>)?,
                            &MenuItem::with_id(app, "open-trash", "Open Trash", false, None::<&str>)?,
                            &MenuItem::with_id(app, "open-settings", "Open Settings", false, None::<&str>)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::quit(app, Some("Quit sticky"))?,
                        ])?,
                    ])?;
                    app.set_menu(menu)?;

                    app.on_menu_event(|app, event| {
                        match event.id().as_ref() {
                            "new-session" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                                let _ = app.emit("session://open-single", true);
                            }
                            _ => {}
                        }
                    });

                    let window = app
                        .get_webview_window("main")
                        .expect("main window not found");

                    window.set_decorations(false)?;
                    window.set_always_on_top(true)?;
                    window.set_shadow(false)?;
                    window.set_visible_on_all_workspaces(true)?;
                    window.set_skip_taskbar(true)?;

                    if let Some(monitor) = window.current_monitor()? {
                        let size = monitor.size();
                        let position = monitor.position();
                        window.set_position(PhysicalPosition::new(position.x, position.y))?;
                        window.set_size(PhysicalSize::new(size.width, size.height))?;
                    }

                    window.set_focus()?;

                    app.global_shortcut().register(open_single_session)?;
                    app.global_shortcut().register(open_session_picker)?;
                    #[cfg(debug_assertions)]
                    app.global_shortcut().register(toggle_clickthrough)?;
                }

                if cfg!(debug_assertions) {
                    app.handle().plugin(
                        tauri_plugin_log::Builder::default()
                            .level(log::LevelFilter::Info)
                            .build(),
                    )?;
                }
                Ok(())
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(desktop)]
#[derive(Default)]
struct OverlayState(std::sync::Mutex<bool>);

#[cfg(desktop)]
impl OverlayState {
    fn toggle_clickthrough(&self) -> Result<bool, String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "failed to lock overlay state".to_string())?;
        *state = !*state;
        Ok(*state)
    }
}
