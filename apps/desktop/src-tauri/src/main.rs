//! A window around the Homie web app. Pairing, live updates, and offline mode
//! stay in that app. This process only remembers where the server is, and the
//! size of the window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod server_url;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use server_url::{normalize_server, DEFAULT_SERVER};

const WINDOW: &str = "main";
/// Where the bundled setup page is served. Windows uses an http host so
/// WebView2 will load it; other systems use Tauri's own scheme. The calendar
/// is a different origin, which is what keeps its service worker working.
#[cfg(windows)]
const SETUP_URL: &str = "http://tauri.localhost/";
#[cfg(not(windows))]
const SETUP_URL: &str = "tauri://localhost";

#[derive(Serialize, Deserialize)]
struct Saved {
    server: String,
}

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("server.json"))
}

fn read_server(app: &AppHandle) -> Option<String> {
    let path = config_file(app).ok()?;
    let text = fs::read_to_string(path).ok()?;
    let saved: Saved = serde_json::from_str(&text).ok()?;
    normalize_server(&saved.server).ok()
}

fn write_server(app: &AppHandle, server: &str) -> Result<(), String> {
    let path = config_file(app)?;
    let body = serde_json::to_string_pretty(&Saved {
        server: server.to_string(),
    })
    .map_err(|e| e.to_string())?;
    fs::write(path, body).map_err(|e| e.to_string())
}

fn probe(origin: &str) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|_| "Could not start the connection check".to_string())?;
    let url = format!("{origin}/api/health");
    let response = client
        .get(&url)
        .send()
        .map_err(|_| format!("Can't reach {origin}. Start Homie, or check the address."))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{origin} answered {status}, which is not Homie."));
    }
    let body = response.text().unwrap_or_default();
    if !body.contains("ok") {
        return Err(format!("{origin} answered, but it is not a Homie server."));
    }
    Ok(())
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(WINDOW)
        .ok_or_else(|| "The window is gone".into())
}

fn show_setup(window: &WebviewWindow) -> Result<(), String> {
    window
        .navigate(
            SETUP_URL
                .parse()
                .map_err(|e: url::ParseError| e.to_string())?,
        )
        .map_err(|e| e.to_string())
}

fn toggle_fullscreen(window: &WebviewWindow) {
    let next = !window.is_fullscreen().unwrap_or(false);
    let _ = window.set_fullscreen(next);
}

#[tauri::command]
fn current_server(app: AppHandle) -> Option<String> {
    read_server(&app).or_else(|| Some(DEFAULT_SERVER.to_string()))
}

#[tauri::command]
fn test_server(url: String) -> Result<String, String> {
    let origin = normalize_server(&url)?;
    probe(&origin)?;
    Ok(origin)
}

#[tauri::command]
fn open_server(app: AppHandle, url: String) -> Result<(), String> {
    let origin = test_server(url)?;
    write_server(&app, &origin)?;
    let window = main_window(&app)?;
    window
        .navigate(origin.parse().map_err(|e: url::ParseError| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let _ = window.set_title("Homie Calendar");
    Ok(())
}

fn install_menu(app: &AppHandle) -> Result<(), String> {
    let window = main_window(app)?;
    let change = MenuItem::with_id(app, "change-server", "Change server…", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let full = MenuItem::with_id(app, "fullscreen", "Full screen", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit")).map_err(|e| e.to_string())?;
    let file = Submenu::with_items(app, "File", true, &[&change, &full, &quit])
        .map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&file]).map_err(|e| e.to_string())?;
    window.set_menu(menu).map_err(|e| e.to_string())?;
    window.on_menu_event(|window, event| {
        let Some(webview) = window.get_webview_window(WINDOW) else {
            return;
        };
        match event.id().as_ref() {
            "change-server" => {
                let _ = show_setup(&webview);
            }
            "fullscreen" => toggle_fullscreen(&webview),
            _ => {}
        }
    });
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window(WINDOW) {
                            toggle_fullscreen(&window);
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            if let Some(server) = read_server(app.handle()) {
                if let Some(window) = app.get_webview_window(WINDOW) {
                    let _ =
                        window.navigate(server.parse().unwrap_or_else(|_| {
                            DEFAULT_SERVER.parse().expect("default server url")
                        }));
                }
            }
            let shortcut: tauri_plugin_global_shortcut::Shortcut = "F11".parse().expect("F11");
            app.global_shortcut()
                .register(shortcut)
                .expect("F11 shortcut");
            install_menu(app.handle()).expect("menu");
            if let Some(window) = app.get_webview_window(WINDOW) {
                let _ = window.show();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            current_server,
            test_server,
            open_server
        ])
        .run(tauri::generate_context!())
        .expect("Homie Calendar failed to start");
}
