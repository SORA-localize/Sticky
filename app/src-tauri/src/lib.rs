#[cfg(desktop)]
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
    };

    let toggle_overlay = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Digit1);
    let toggle_clickthrough =
        Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Digit2);

    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler({
                    let toggle_overlay = toggle_overlay.clone();
                    let toggle_clickthrough = toggle_clickthrough.clone();
                    move |app, shortcut, event| {
                        if event.state() != ShortcutState::Pressed {
                            return;
                        }

                        let Some(window) = app.get_webview_window("main") else {
                            return;
                        };

                        if shortcut == &toggle_overlay {
                            let visible = window.is_visible().unwrap_or(false);
                            let next = !visible;

                            if next {
                                let _ = window.show();
                                let _ = window.set_focus();
                            } else {
                                let _ = window.hide();
                            }

                            let _ = app.emit("overlay://visibility", next);
                        }

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
            let toggle_overlay = toggle_overlay.clone();
            let toggle_clickthrough = toggle_clickthrough.clone();
            move |app| {
                #[cfg(desktop)]
                {
                    app.manage(OverlayState::default());

                    let window = app
                        .get_webview_window("main")
                        .expect("main window not found");

                    window.set_decorations(false)?;
                    window.set_always_on_top(true)?;
                    window.set_shadow(false)?;
                    window.set_visible_on_all_workspaces(true)?;
                    window.set_skip_taskbar(true)?;
                    window.set_fullscreen(true)?;
                    window.set_focus()?;

                    app.global_shortcut().register(toggle_overlay)?;
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
