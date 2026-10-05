// The app's window and menu (story 13.5, E13-R1, E13-R3, E13-R4).
//
// AD-15 inside the webview: the window loads the server's own origin, no Tauri capability or IPC is
// granted to it, navigation off that origin is refused, a new window is always denied, and outside
// links open in the system browser. The shell passes no launch URL on a command line.
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::json;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::report::report;
use crate::server::{self, QuitAnswer};

/// Set once the quit has begun, so a second request (menu, window, Dock) does nothing.
static QUITTING: AtomicBool = AtomicBool::new(false);

pub fn quitting() -> bool {
    QUITTING.load(Ordering::SeqCst)
}

fn same_origin(url: &Url, port: u16) -> bool {
    url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(port)
}

/// Off-origin http(s) links open in the system browser; nothing else opens.
fn open_external(url: &Url) {
    if !matches!(url.scheme(), "http" | "https") {
        return;
    }
    let u = url.as_str();
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg(u).spawn();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", u]).creation_flags(0x0800_0000).spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = Command::new("xdg-open").arg(u).spawn();
}

pub fn open_window(app: &AppHandle, port: u16, launch_url: &str) -> Result<(), String> {
    let launch: Url = launch_url.parse().map_err(|e| format!("{e}"))?;
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(launch))
        .title("Ogden Agents")
        .inner_size(1280.0, 840.0)
        .min_inner_size(480.0, 600.0)
        .on_navigation(move |url| {
            if same_origin(url, port) {
                return true;
            }
            // AD-15: the webview stays on the server's origin.
            report("navigation_blocked", json!({ "url": url.as_str() }));
            open_external(url);
            false
        })
        .on_new_window(|url, _features| {
            report("new_window_denied", json!({ "url": url.as_str() }));
            open_external(&url);
            NewWindowResponse::Deny
        })
        .on_page_load(|_window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                report("page_finished", json!({ "url": payload.url().origin().ascii_serialization() }));
            }
        });
    let window = builder.build().map_err(|e| e.to_string())?;
    #[cfg(windows)]
    if let Ok(menu) = build_menu(app) {
        let _ = window.set_menu(menu);
    }
    #[cfg(not(windows))]
    let _ = window;
    Ok(())
}

/// Brings the window forward, showing it if it was hidden or minimised.
pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// About, Check for updates and Quit (and Edit, so copy and paste work in the page on macOS).
pub fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = MenuItem::with_id(app, "about", "About Ogden Agents", true, None::<&str>)?;
    let check = MenuItem::with_id(app, "check_updates", "Check for Updates", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Ogden Agents", true, Some("CmdOrCtrl+Q"))?;
    let separator = PredefinedMenuItem::separator(app)?;
    let app_menu = Submenu::with_items(app, "Ogden Agents", true, &[&about, &check, &separator, &quit])?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit])
}

pub fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "quit" => request_quit(app, "menu"),
        "about" => {
            let app = app.clone();
            std::thread::spawn(move || {
                let version = app.package_info().version.to_string();
                app.dialog().message(format!("Ogden Agents {version}")).title("About Ogden Agents").kind(MessageDialogKind::Info).blocking_show();
            });
        }
        "check_updates" => {
            // A stub until story 13.10 (the updater): say so plainly.
            let app = app.clone();
            std::thread::spawn(move || {
                app.dialog()
                    .message("Ogden Agents looks for updates each time it starts. Checking from this menu is coming in a later version.")
                    .title("Check for Updates")
                    .kind(MessageDialogKind::Info)
                    .blocking_show();
            });
        }
        _ => {}
    }
}

/// Whether the user wants to quit while agents are working. A test hook answers for the user in CI.
fn confirm_quit_anyway(app: &AppHandle, busy: u64) -> bool {
    report("confirm_asked", json!({ "busySessions": busy }));
    if let Ok(answer) = std::env::var("OGDEN_DESKTOP_TEST_CONFIRM") {
        return answer == "quit";
    }
    let what = if busy == 1 { "An agent is still working." } else { "Agents are still working." };
    app.dialog()
        .message(format!("{what} If you quit now, their work stops. Quit anyway?"))
        .title("Quit Ogden Agents")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Quit anyway".into(), "Keep working".into()))
        .blocking_show()
}

/// The one quit path: the menu, the window, the Dock and the test hook all end here. Asks the
/// server it started to quit (with the user's confirmation if agents are working), stops what is
/// left, then exits. A server the app only attached to is left running.
pub fn request_quit(app: &AppHandle, why: &'static str) {
    if QUITTING.swap(true, Ordering::SeqCst) {
        return;
    }
    report("quit", json!({ "why": why }));
    let app = app.clone();
    std::thread::spawn(move || {
        let mut answer = server::quit(false);
        if let QuitAnswer::Busy(n) = answer {
            if !confirm_quit_anyway(&app, n) {
                report("quit_cancelled", json!({}));
                QUITTING.store(false, Ordering::SeqCst);
                return;
            }
            answer = server::quit(true);
        }
        let _ = answer;
        app.exit(0);
    });
}

/// A start that failed says why in plain words, then the app ends.
pub fn fail_start(app: &AppHandle, reason: &str) {
    report("server_error", json!({ "error": reason }));
    let app = app.clone();
    let text = format!("Ogden Agents could not start. Quit and open it again. If it keeps happening, its log is in your data folder.\n\n{reason}");
    std::thread::spawn(move || {
        app.dialog().message(text).title("Ogden Agents").kind(MessageDialogKind::Error).blocking_show();
        QUITTING.store(true, Ordering::SeqCst);
        server::on_exit();
        app.exit(1);
    });
}
