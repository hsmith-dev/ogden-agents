// Ogden Agents as a desktop app (epic 13): a Tauri shell that runs Ogden's packed launcher on the
// bundled Node (the `ogden-node` sidecar), which starts or finds the server, and opens the window on
// the server's one-time launch URL, the way the launcher opens a browser tab (AD-3, AD-15, AD-20, AD-21).
//
// AD-15 inside the webview: no Tauri capability or IPC is granted to the page; see ui.rs.
//
// Lifecycle (story 13.5): a second launch focuses this window; Quit (menu, window close on Windows,
// Dock) asks the server this app started to quit, confirming with the user first if agents are
// working; a server the app only attached to keeps running; closing the window on macOS hides it and
// the app stays in the Dock; on Windows a kill-on-close job object stops everything if the shell dies.
//
// Test hooks (used only by CI; they write or read nothing secret):
//   OGDEN_DESKTOP_TEST_REPORT    append JSON lines of what the shell did to this file
//   OGDEN_DESKTOP_TEST_QUIT_FILE quit through the normal quit path when this file appears
//   OGDEN_DESKTOP_TEST_CONFIRM   answer the "agents are working" question: `quit` or `keep`
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod report;
mod server;
mod ui;

use std::path::PathBuf;
use std::time::Duration;

use serde_json::json;
use tauri::RunEvent;

use report::report;

/// Windows: put this process in a job that kills everything in it when the last handle closes (the
/// shell exiting or being killed), so no server or agent outlives the app. Children inherit it.
#[cfg(windows)]
fn join_kill_on_close_job() {
    let result = (|| -> Result<(), win32job::JobError> {
        let job = win32job::Job::create()?;
        let mut info = job.query_extended_limit_info()?;
        info.limit_kill_on_job_close();
        job.set_extended_limit_info(&info)?;
        job.assign_current_process()?;
        // Kept open for the life of this process.
        std::mem::forget(job);
        Ok(())
    })();
    report("job_object", json!({ "ok": result.is_ok() }));
}

fn main() {
    #[cfg(windows)]
    join_kill_on_close_job();

    let app = tauri::Builder::default()
        // Registered first: a second launch hands over to this one and exits.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            report("second_launch", json!({}));
            ui::show_main(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .on_menu_event(|app, event| ui::on_menu(app, event.id().as_ref()))
        .setup(|app| {
            let handle = app.handle().clone();
            report("shell_start", json!({ "version": handle.package_info().version.to_string() }));
            if let Ok(menu) = ui::build_menu(&handle) {
                let _ = app.set_menu(menu);
            }
            if let Some(file) = std::env::var_os("OGDEN_DESKTOP_TEST_QUIT_FILE") {
                let h = handle.clone();
                std::thread::spawn(move || loop {
                    if PathBuf::from(&file).exists() {
                        // Re-armed if the user (the test) said to keep working.
                        let _ = std::fs::remove_file(&file);
                        ui::request_quit(&h, "test-quit-file");
                    }
                    std::thread::sleep(Duration::from_millis(250));
                });
            }
            std::thread::spawn(move || match server::start(&handle) {
                Ok(info) => match ui::open_window(&handle, info.port, &info.launch_url) {
                    Ok(()) => report("window_created", json!({})),
                    Err(e) => ui::fail_start(&handle, &e),
                },
                Err(e) => ui::fail_start(&handle, &e),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if cfg!(target_os = "macos") {
                    // As Mac apps do: the window goes, the app stays in the Dock until Quit.
                    let _ = window.hide();
                    report("window_hidden", json!({}));
                } else {
                    ui::request_quit(window.app_handle(), "window-closed");
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Ogden Agents");

    app.run(|app, event| match event {
        RunEvent::ExitRequested { api, code, .. } => {
            // Quit from the Dock (or the system) arrives with no code: take it through the one quit path.
            if code.is_none() && !ui::quitting() {
                api.prevent_exit();
                ui::request_quit(app, "exit-requested");
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => ui::show_main(app),
        RunEvent::Exit => server::on_exit(),
        _ => {}
    });
}
