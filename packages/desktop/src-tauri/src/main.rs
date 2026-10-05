// Ogden Agents as a desktop app (epic 13): a Tauri shell that starts Ogden's packed server on
// the bundled Node (the `ogden-node` sidecar) and opens its window on the server's one-time
// launch URL, the way the launcher opens a browser tab (AD-3, AD-15, AD-20, AD-21).
//
// AD-15 inside the webview: the window loads the server's own origin, no Tauri capability or
// IPC is granted to it, navigation off that origin is refused, and outside links open in the
// system browser. The shell passes no launch URL on a command line.
//
// Story 13.2 (tracer) starts the server and opens the window; closing the window quits. 13.3
// to 13.5 add the launcher handshake mode, the single-instance plugin, the app menu and the
// quit through the server.
//
// Test hooks (used only by CI's smoke test; harmless otherwise, and they read nothing secret):
//   OGDEN_DESKTOP_TEST_REPORT   append JSON lines of what the shell did to this file
//   OGDEN_DESKTOP_TEST_QUIT_FILE  quit through the normal quit path when this file appears
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// The server this app started (and so stops on quit). `None` when it attached to one that was
/// already running, which the app leaves running.
static SERVER: Mutex<Option<Child>> = Mutex::new(None);

/// `serve.js` exits with this code when another server holds the data folder (instance-lock.ts).
const EXIT_ALREADY_RUNNING: i32 = 3;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn report(ev: &str, data: Value) {
    let Some(path) = std::env::var_os("OGDEN_DESKTOP_TEST_REPORT") else { return };
    let line = json!({ "t": now_ms(), "ev": ev, "pid": std::process::id(), "data": data }).to_string();
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{line}");
    }
}

/// The data folder `dataDirPath()` gives (packages/core/src/data-dir.ts): `$OGDEN_AGENTS_DATA_DIR`,
/// else env-paths' per-user data folder for `ogden-agents`.
fn data_dir() -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("OGDEN_AGENTS_DATA_DIR").filter(|v| !v.to_string_lossy().trim().is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .ok_or("no home folder")?;
    Ok(if cfg!(target_os = "macos") {
        home.join("Library").join("Application Support").join("ogden-agents")
    } else if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Local"))
            .join("ogden-agents")
            .join("Data")
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .unwrap_or_else(|| home.join(".local").join("share"))
            .join("ogden-agents")
    })
}

/// Windows gives the resource dir as a verbatim `\\?\C:\...` path; Node and npm get plain ones.
fn plain_path(p: PathBuf) -> PathBuf {
    let plain: Option<PathBuf> = {
        let s = p.to_string_lossy();
        s.strip_prefix(r"\\?\").filter(|rest| !rest.starts_with("UNC\\")).map(PathBuf::from)
    };
    plain.unwrap_or(p)
}

#[cfg(unix)]
fn kill_group(pid: u32) {
    // The server leads its own process group (process_group(0) below).
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}

#[cfg(windows)]
fn kill_group(pid: u32) {
    use std::os::windows::process::CommandExt;
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let _ = Command::new(PathBuf::from(root).join("System32").join("taskkill.exe"))
        .args(["/pid", &pid.to_string(), "/T", "/F"])
        .creation_flags(0x0800_0000)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// Stops the server this app started: a polite signal first where there is one (the server
/// closes its sessions and removes its files), then the whole process group or tree.
fn stop_server(why: &str) {
    let Some(mut child) = SERVER.lock().ok().and_then(|mut g| g.take()) else { return };
    let pid = child.id();
    #[cfg(unix)]
    {
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    // Anything left (an agent the server started, or a server that did not stop in time).
    kill_group(pid);
    let _ = child.wait();
    report("server_stopped", json!({ "serverPid": pid, "why": why }));
}

struct Started {
    launch_url: String,
    port: u16,
}

/// Reads `<dataDir>/server.json` as `{port, pid}`.
fn read_record(data_dir: &std::path::Path) -> Option<(u16, u32)> {
    let v: Value = serde_json::from_str(&fs::read_to_string(data_dir.join("server.json")).ok()?).ok()?;
    Some((v["port"].as_u64()? as u16, v["pid"].as_u64()? as u32))
}

fn start_server(app: &AppHandle) -> Result<Started, String> {
    let t0 = Instant::now();
    let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?.parent().ok_or("no exe folder")?.to_path_buf();
    let node = exe_dir.join(if cfg!(windows) { "ogden-node.exe" } else { "ogden-node" });
    let res = plain_path(app.path().resource_dir().map_err(|e| e.to_string())?);
    let pkg = res.join("app").join("node_modules").join("ogden-agents");
    let serve = pkg.join("dist").join("serve.js");
    let web = pkg.join("dist").join("web");
    let npm_cli = res.join("npm").join("bin").join("npm-cli.js");
    let data_dir = data_dir()?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    report("paths", json!({ "node": node, "nodeExists": node.exists(), "serveExists": serve.exists(), "dataDir": data_dir }));

    let mut cmd = Command::new(&node);
    cmd.arg(&serve)
        .arg("--web-root")
        .arg(&web)
        .env("OGDEN_AGENTS_DATA_DIR", &data_dir)
        // findNpmCli's second rule (`launcherNpm`, read at server start): the bundled npm, so
        // installing an agent works with no Node on the machine.
        .env("npm_execpath", &npm_cli)
        // As launcher.ts does: the server must not hold the install folder open as its cwd.
        .current_dir(&data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let child = cmd.spawn().map_err(|e| format!("spawn {}: {e}", node.display()))?;
    let pid = child.id();
    #[cfg(windows)]
    attach_job(&child);
    *SERVER.lock().map_err(|e| e.to_string())? = Some(child);
    report("server_spawned", json!({ "serverPid": pid }));

    // The server writes server.json ({port, pid}) and launcher.token once it listens. If another
    // server (for example one `npx ogden-agents` started) already holds the data folder, ours
    // exits with code 3 and this attaches to that one instead, leaving it running on quit.
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut want_pid = Some(pid);
    loop {
        let exited = SERVER.lock().ok().and_then(|mut g| g.as_mut().and_then(|c| c.try_wait().ok().flatten()));
        if let Some(status) = exited {
            if status.code() == Some(EXIT_ALREADY_RUNNING) {
                if let Ok(mut g) = SERVER.lock() {
                    *g = None;
                }
                want_pid = None;
                report("attached", json!({}));
            } else {
                return Err(format!("the server stopped while starting ({status})"));
            }
        }
        if Instant::now() > deadline {
            return Err("the server did not start within 60 seconds".into());
        }
        let token = fs::read_to_string(data_dir.join("launcher.token")).ok().map(|t| t.trim().to_string());
        if let (Some((port, rec_pid)), Some(token)) = (read_record(&data_dir), token) {
            if want_pid.map_or(true, |p| p == rec_pid) {
                let url = format!("http://127.0.0.1:{port}/launcher/hello?launch=1");
                if let Ok(resp) = ureq::get(&url).set("x-ogden-launcher-token", &token).timeout(Duration::from_secs(3)).call() {
                    let body: Value = resp.into_string().ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
                    if let Some(launch) = body["launchUrl"].as_str() {
                        report("server_ready", json!({ "port": port, "version": body["version"], "ms": t0.elapsed().as_millis() as u64 }));
                        return Ok(Started { launch_url: launch.to_string(), port });
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Puts the server in a kill-on-close job object, so when the shell exits or is killed Windows
/// stops the server and everything it started (spike 13.1: a direct kill alone left children).
#[cfg(windows)]
fn attach_job(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    let result = (|| -> Result<(), win32job::JobError> {
        let job = win32job::Job::create()?;
        let mut info = job.query_extended_limit_info()?;
        info.limit_kill_on_job_close();
        job.set_extended_limit_info(&info)?;
        job.assign_process(child.as_raw_handle() as isize)?;
        // Kept open for the life of this process: Windows closes the handle when the shell exits.
        std::mem::forget(job);
        Ok(())
    })();
    report("job_object", json!({ "ok": result.is_ok() }));
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

fn open_window(app: &AppHandle, started: Started) -> Result<(), String> {
    let port = started.port;
    let launch: Url = started.launch_url.parse().map_err(|e| format!("{e}"))?;
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(launch))
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
        })
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// The one quit path: menu, window close and the test hook all end here.
fn quit(app: &AppHandle, why: &str) {
    report("quit", json!({ "why": why }));
    stop_server(why);
    app.exit(0);
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            report("shell_start", json!({ "version": handle.package_info().version.to_string() }));
            if let Some(file) = std::env::var_os("OGDEN_DESKTOP_TEST_QUIT_FILE") {
                let h = handle.clone();
                std::thread::spawn(move || loop {
                    if PathBuf::from(&file).exists() {
                        return quit(&h, "test-quit-file");
                    }
                    std::thread::sleep(Duration::from_millis(250));
                });
            }
            std::thread::spawn(move || match start_server(&handle) {
                Ok(started) => match open_window(&handle, started) {
                    Ok(()) => report("window_created", json!({})),
                    Err(e) => {
                        report("window_error", json!({ "error": e }));
                        quit(&handle, "window-error");
                    }
                },
                Err(e) => {
                    report("server_error", json!({ "error": e }));
                    quit(&handle, "start-failed");
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Tracer: closing the window quits the app and the server it started (AD-3 note).
            if let WindowEvent::CloseRequested { .. } = event {
                quit(window.app_handle(), "window-closed");
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Ogden Agents");

    app.run(|_app, event| {
        if let RunEvent::Exit = event {
            stop_server("app-exit");
        }
    });
}
