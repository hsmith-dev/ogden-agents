// SPIKE 13.1 (temporary, reference for 13.2): the smallest Tauri shell that
// starts Ogden's packed server on the bundled Node and opens a window on the
// one-time launch URL, with no Tauri IPC granted to the web content (AD-15).
//
// Spike-only behaviour is behind OGDEN_SPIKE_* environment variables:
//   OGDEN_SPIKE_REPORT       append JSON lines (events with epoch ms) to this file
//   OGDEN_SPIKE_AUTOQUIT_MS  quit this long after the webview probe (default 6000)
//   OGDEN_SPIKE_KILL         tree (default) | direct | none: how quitting stops the server
//   OGDEN_SPIKE_NOJOB        on Windows, do not put the server in a kill-on-close job object
//   OGDEN_SPIKE_PRELOAD      an .mjs the server's Node imports first (spawns a grandchild)
//   OGDEN_SPIKE_UPDATE_URL   run the updater against this latest.json instead of probing
// Without them it behaves as a plain app with its own data folder.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;

static SERVER: Mutex<Option<Child>> = Mutex::new(None);
static PAGE_SEEN: AtomicBool = AtomicBool::new(false);

const PROBE_PATH: &str = "/__spike_probe";

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn spike() -> bool {
    std::env::var_os("OGDEN_SPIKE_REPORT").is_some()
}

fn report(ev: &str, data: Value) {
    let line = json!({ "t": now_ms() as u64, "ev": ev, "pid": std::process::id(), "data": data }).to_string();
    eprintln!("{line}");
    if let Some(path) = std::env::var_os("OGDEN_SPIKE_REPORT") {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{line}");
        }
    }
}

fn kill_mode() -> String {
    std::env::var("OGDEN_SPIKE_KILL").unwrap_or_else(|_| "tree".into())
}

/// Stops the server the way `killProcessTree` does (packages/adapters/src/process-tree.ts).
fn stop_server(why: &str) {
    let Some(mut child) = SERVER.lock().ok().and_then(|mut g| g.take()) else { return };
    let pid = child.id();
    let mode = kill_mode();
    match mode.as_str() {
        "none" => {}
        "direct" => {
            let _ = child.kill();
            let _ = child.wait();
        }
        _ => {
            kill_tree(pid);
            let _ = child.wait();
        }
    }
    report("server_stopped", json!({ "serverPid": pid, "mode": mode, "why": why }));
}

#[cfg(unix)]
fn kill_tree(pid: u32) {
    // The server leads its own process group (process_group(0) below).
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}

#[cfg(windows)]
fn kill_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let _ = Command::new(PathBuf::from(root).join("System32").join("taskkill.exe"))
        .args(["/pid", &pid.to_string(), "/T", "/F"])
        .creation_flags(0x0800_0000)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

struct Started {
    port: u16,
    launch_url: String,
}

fn start_server(app: &AppHandle) -> Result<Started, String> {
    let t0 = Instant::now();
    let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?.parent().unwrap().to_path_buf();
    let node = exe_dir.join(if cfg!(windows) { "ogden-node.exe" } else { "ogden-node" });
    let res = app.path().resource_dir().map_err(|e| e.to_string())?;
    let pkg = res.join("app").join("node_modules").join("ogden-agents");
    let serve = pkg.join("dist").join("serve.js");
    let web = pkg.join("dist").join("web");
    let npm_cli = res.join("npm").join("bin").join("npm-cli.js");
    let data_dir = match std::env::var_os("OGDEN_AGENTS_DATA_DIR") {
        Some(d) => PathBuf::from(d),
        None => app.path().app_data_dir().map_err(|e| e.to_string())?.join("spike-data"),
    };
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    report(
        "paths",
        json!({ "node": node, "nodeExists": node.exists(), "resourceDir": res, "serve": serve, "serveExists": serve.exists(),
                "npmCli": npm_cli, "npmCliExists": npm_cli.exists(), "dataDir": data_dir, "exeDir": exe_dir }),
    );

    let mut cmd = Command::new(&node);
    if let Some(preload) = std::env::var_os("OGDEN_SPIKE_PRELOAD") {
        let url = Url::from_file_path(PathBuf::from(preload)).map_err(|_| "bad preload path".to_string())?;
        cmd.arg("--import").arg(url.as_str());
    }
    cmd.arg(&serve)
        .arg("--web-root")
        .arg(&web)
        .env("OGDEN_AGENTS_DATA_DIR", &data_dir)
        // findNpmCli's second rule (`launcherNpm`, read at server start): the bundled npm.
        .env("npm_execpath", &npm_cli)
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
    let job = attach_job(&child);
    #[cfg(not(windows))]
    let job = Value::Null;
    report("server_spawned", json!({ "serverPid": pid, "ms": t0.elapsed().as_millis() as u64, "job": job }));
    *SERVER.lock().unwrap() = Some(child);

    // The server writes server.json ({port, pid}) and launcher.token once it listens.
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        if let Some(c) = SERVER.lock().unwrap().as_mut() {
            if let Ok(Some(status)) = c.try_wait() {
                return Err(format!("server exited early: {status}"));
            }
        }
        if Instant::now() > deadline {
            return Err("server did not write server.json within 60 s".into());
        }
        let record: Option<Value> =
            fs::read_to_string(data_dir.join("server.json")).ok().and_then(|t| serde_json::from_str(&t).ok());
        let token = fs::read_to_string(data_dir.join("launcher.token")).ok().map(|t| t.trim().to_string());
        if let (Some(rec), Some(token)) = (record, token) {
            if rec["pid"].as_u64() == Some(pid as u64) {
                let port = rec["port"].as_u64().unwrap_or(0) as u16;
                let url = format!("http://127.0.0.1:{port}/launcher/hello?launch=1");
                if let Ok(resp) = ureq::get(&url)
                    .set("x-ogden-launcher-token", &token)
                    .timeout(Duration::from_secs(3))
                    .call()
                {
                    let body: Value = resp.into_string().ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
                    if let Some(launch) = body["launchUrl"].as_str() {
                        report(
                            "server_ready",
                            json!({ "port": port, "version": body["version"], "ms": t0.elapsed().as_millis() as u64 }),
                        );
                        return Ok(Started { port, launch_url: launch.to_string() });
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(windows)]
fn attach_job(child: &Child) -> Value {
    use std::os::windows::io::AsRawHandle;
    if std::env::var_os("OGDEN_SPIKE_NOJOB").is_some() {
        return json!("off");
    }
    let result = (|| -> Result<(), win32job::JobError> {
        let job = win32job::Job::create()?;
        let mut info = job.query_extended_limit_info()?;
        info.limit_kill_on_job_close();
        job.set_extended_limit_info(&info)?;
        job.assign_process(child.as_raw_handle() as isize)?;
        // Kept open for the life of this process: when the shell exits (or is
        // killed) Windows closes the handle and kills every process in the job.
        std::mem::forget(job);
        Ok(())
    })();
    match result {
        Ok(()) => json!("kill-on-close"),
        Err(e) => json!(format!("failed: {e:?}")),
    }
}

/// Runs in the page (via the shell's eval, not IPC). It reports back by
/// navigating to a same-origin probe URL that the shell records and cancels.
const PROBE_JS: &str = r#"
(async () => {
  const r = {};
  const send = (stage, d) => { location.href = '/__spike_probe?stage=' + stage + '&d=' + encodeURIComponent(JSON.stringify(d)); };
  try {
    r.href = location.href; r.origin = location.origin;
    const t = sessionStorage.getItem('ogden-agents.tab-token');
    r.hasTabToken = !!t;
    r.tabWithToken = (await fetch('/api/v1/tab', { headers: { Authorization: 'Bearer ' + t } })).status;
    r.tabWithoutToken = (await fetch('/api/v1/tab')).status;
    const ws = (protocols) => new Promise((res) => {
      let w; const to = setTimeout(() => res('timeout'), 4000);
      try { w = new WebSocket('ws://' + location.host + '/ws', protocols); } catch (e) { clearTimeout(to); return res('throw:' + e); }
      w.onopen = () => { clearTimeout(to); res('open:' + w.protocol); w.close(); };
      w.onerror = () => { clearTimeout(to); res('error'); };
    });
    r.wsWithToken = await ws(['ogden.v1', 'ogden.auth.' + t]);
    r.wsWithoutToken = await ws(['ogden.v1']);
    r.tauriInternals = typeof window.__TAURI_INTERNALS__;
    r.tauriGlobal = typeof window.__TAURI__;
    if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
      try { await window.__TAURI_INTERNALS__.invoke('plugin:updater|check', {}); r.ipcUpdater = 'ALLOWED'; }
      catch (e) { r.ipcUpdater = 'denied: ' + String(e).slice(0, 160); }
      try { await window.__TAURI_INTERNALS__.invoke('plugin:app|version'); r.ipcApp = 'ALLOWED'; }
      catch (e) { r.ipcApp = 'denied: ' + String(e).slice(0, 160); }
    }
    try { const w = window.open('https://example.com/'); r.windowOpen = w === null ? 'null' : 'opened'; } catch (e) { r.windowOpen = 'throw'; }
    r.userAgent = navigator.userAgent;
    r.bodyText = (document.body ? document.body.innerText : '').slice(0, 400);
  } catch (e) { r.error = String(e); }
  send('checks', r);
  setTimeout(() => { location.href = 'https://example.com/'; }, 700);
  setTimeout(() => send('final', { href: location.href }), 2000);
})();
"#;

fn same_origin(url: &Url, port: u16) -> bool {
    url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(port)
}

fn open_window(app: &AppHandle, started: Started) -> Result<(), String> {
    let port = started.port;
    let launch: Url = started.launch_url.parse().map_err(|e| format!("{e}"))?;
    let nav_app = app.clone();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(launch))
        .title("Ogden Agents (spike)")
        .inner_size(1200.0, 800.0)
        .on_navigation(move |url| {
            if same_origin(url, port) {
                if url.path() == PROBE_PATH {
                    let get = |k: &str| url.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned());
                    let stage = get("stage").unwrap_or_default();
                    let data: Value = get("d").and_then(|d| serde_json::from_str(&d).ok()).unwrap_or(Value::Null);
                    report("probe", json!({ "stage": stage, "result": data }));
                    if stage == "final" {
                        schedule_quit(nav_app.clone());
                    }
                    return false;
                }
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
        .on_page_load(|window, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            report("page_finished", json!({ "url": payload.url().as_str() }));
            if spike() && std::env::var_os("OGDEN_SPIKE_UPDATE_URL").is_none() && !PAGE_SEEN.swap(true, Ordering::SeqCst) {
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(3));
                    let ok = window.eval(PROBE_JS).is_ok();
                    report("probe_injected", json!({ "ok": ok }));
                });
            }
        })
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Outside spike runs, off-origin http(s) links open in the system browser.
fn open_external(url: &Url) {
    if spike() || !matches!(url.scheme(), "http" | "https") {
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

fn schedule_quit(app: AppHandle) {
    let ms = std::env::var("OGDEN_SPIKE_AUTOQUIT_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(6000u64);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(ms));
        report("autoquit", json!({ "afterMs": ms }));
        app.exit(0);
    });
}

async fn run_update(app: AppHandle, endpoint: String) {
    let current = app.package_info().version.to_string();
    let url: Url = match endpoint.parse() {
        Ok(u) => u,
        Err(e) => return report("update_error", json!({ "stage": "url", "error": e.to_string() })),
    };
    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map(|b| b.on_before_exit(|| stop_server("updater-before-exit")))
        .and_then(|b| b.build());
    let updater = match updater {
        Ok(u) => u,
        Err(e) => {
            report("update_error", json!({ "stage": "build", "error": e.to_string() }));
            return schedule_quit(app);
        }
    };
    match updater.check().await {
        Ok(Some(update)) => {
            report("update_available", json!({ "current": update.current_version, "version": update.version }));
            match update.download_and_install(|_, _| {}, || {}).await {
                Ok(()) => {
                    report("update_installed", json!({ "from": current }));
                    stop_server("update-restart");
                    app.restart();
                }
                Err(e) => {
                    report("update_error", json!({ "stage": "install", "error": e.to_string(), "current": current }));
                    schedule_quit(app);
                }
            }
        }
        Ok(None) => {
            report("update_none", json!({ "current": current }));
            schedule_quit(app);
        }
        Err(e) => {
            report("update_error", json!({ "stage": "check", "error": e.to_string(), "current": current }));
            schedule_quit(app);
        }
    }
}

fn main() {
    report("shell_start", json!({ "os": std::env::consts::OS, "arch": std::env::consts::ARCH }));
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            report(
                "app_info",
                json!({ "version": handle.package_info().version.to_string(),
                        "webview": tauri::webview_version().unwrap_or_else(|e| format!("error: {e}")) }),
            );
            std::thread::spawn(move || match start_server(&handle) {
                Ok(started) => {
                    if let Err(e) = open_window(&handle, started) {
                        report("window_error", json!({ "error": e }));
                    } else {
                        report("window_created", json!({}));
                    }
                    if let Ok(endpoint) = std::env::var("OGDEN_SPIKE_UPDATE_URL") {
                        let h = handle.clone();
                        tauri::async_runtime::spawn(run_update(h, endpoint));
                    }
                }
                Err(e) => {
                    report("server_error", json!({ "error": e }));
                    stop_server("start-failed");
                    handle.exit(1);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the spike shell");

    app.run(|_app, event| {
        if let RunEvent::Exit = event {
            stop_server("app-exit");
        }
    });
}
