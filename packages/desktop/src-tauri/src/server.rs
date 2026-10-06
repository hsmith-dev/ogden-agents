// The bundled server's life, from the shell's side (story 13.5, E13-R4; AD-3, AD-20).
//
// The shell never re-implements the launcher's find, attach and AD-20 handshake: it runs the
// packed launcher (`bin/ogden.js --json --no-open`) on the bundled Node, which prints one JSON line
// `{action, owned, port, pid, version, url, launchUrl, dataDir}`. When `owned` is true the launcher
// started the server and stays alive holding the server's stdin pipe, so the server exits when the
// shell goes away however it ends. When `owned` is false the app attached to a server that was
// already running (`npx ogden-agents`, for example): it is never stopped by the app.
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::report::{descendants, kill_pid, report};

pub struct ServerInfo {
    pub owned: bool,
    pub port: u16,
    pub pid: u32,
    pub launch_url: String,
    pub data_dir: PathBuf,
}

/// The launcher this app started (kept so its stdin pipe stays open while the app lives).
static LAUNCHER: Mutex<Option<Child>> = Mutex::new(None);
/// What the launcher reported, minus the launch link (a one-time secret: never stored here).
static INFO: Mutex<Option<(bool, u16, u32, PathBuf)>> = Mutex::new(None);

pub fn plain_path(p: PathBuf) -> PathBuf {
    // Windows gives the resource dir as a verbatim `\\?\C:\...` path; Node and npm get plain ones.
    let plain: Option<PathBuf> = {
        let s = p.to_string_lossy();
        s.strip_prefix(r"\\?\").filter(|rest| !rest.starts_with("UNC\\")).map(PathBuf::from)
    };
    plain.unwrap_or(p)
}

pub fn start(app: &AppHandle) -> Result<ServerInfo, String> {
    let t0 = Instant::now();
    let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?.parent().ok_or("no exe folder")?.to_path_buf();
    let node = exe_dir.join(if cfg!(windows) { "ogden-node.exe" } else { "ogden-node" });
    let res = plain_path(app.path().resource_dir().map_err(|e| e.to_string())?);
    let pkg = res.join("app").join("node_modules").join("ogden-agents");
    let launcher_js = pkg.join("bin").join("ogden.js");
    let npm_cli = res.join("npm").join("bin").join("npm-cli.js");
    report("paths", json!({ "nodeExists": node.exists(), "launcherExists": launcher_js.exists(), "npmExists": npm_cli.exists() }));

    let mut cmd = Command::new(&node);
    cmd.arg(&launcher_js)
        .args(["--json", "--no-open"])
        // The only thing that makes the server an app server (story 13.3): the parent watch, the
        // update calls, the app's wording.
        .env("OGDEN_AGENTS_SHELL", "desktop")
        // findNpmCli's launcher-npm rule (read at server start): the bundled npm, so installing an
        // agent needs no Node on the machine.
        .env("npm_execpath", &npm_cli)
        // Not the install folder: nothing here may keep the app's files open (updates replace them).
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
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
    let mut child = cmd.spawn().map_err(|e| format!("could not start {}: {e}", node.display()))?;
    let stdout = child.stdout.take().ok_or("no launcher output")?;
    let stderr = child.stderr.take().ok_or("no launcher errors")?;

    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        if reader.read_line(&mut line).map(|n| n > 0).unwrap_or(false) {
            let _ = tx.send(line);
        }
        // Keep draining so the launcher never blocks on a full pipe.
        let mut sink = String::new();
        while reader.read_line(&mut sink).map(|n| n > 0).unwrap_or(false) {
            sink.clear();
        }
    });
    let errors = Arc::new(Mutex::new(String::new()));
    let errors_writer = Arc::clone(&errors);
    std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.take(4096).read_to_string(&mut text);
        if let Ok(mut g) = errors_writer.lock() {
            *g = text;
        }
    });

    let line = match rx.recv_timeout(Duration::from_secs(70)) {
        Ok(line) => line,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            let why = errors.lock().map(|g| g.trim().to_string()).unwrap_or_default();
            return Err(if why.is_empty() { "Ogden Agents did not start in time.".to_string() } else { why });
        }
    };
    let v: Value = serde_json::from_str(line.trim()).map_err(|e| format!("the launcher's answer was not understood: {e}"))?;
    let owned = v["owned"].as_bool().unwrap_or(false);
    let port = v["port"].as_u64().ok_or("the launcher gave no port")? as u16;
    let pid = v["pid"].as_u64().ok_or("the launcher gave no process id")? as u32;
    let data_dir = PathBuf::from(v["dataDir"].as_str().ok_or("the launcher gave no data folder")?);
    let launch_url = v["launchUrl"].as_str().ok_or("the launcher gave no link")?.to_string();
    report("server_ready", json!({ "owned": owned, "action": v["action"], "port": port, "version": v["version"], "ms": t0.elapsed().as_millis() as u64 }));

    if owned {
        // Held: this process keeps the pipe to the launcher open; when it ends, the server follows.
        *LAUNCHER.lock().map_err(|e| e.to_string())? = Some(child);
    } else {
        // Attached: the launcher exits by itself, and the server it found is none of ours to stop.
        let _ = child.wait();
    }
    *INFO.lock().map_err(|e| e.to_string())? = Some((owned, port, pid, data_dir.clone()));
    Ok(ServerInfo { owned, port, pid, launch_url, data_dir })
}

/// A fresh one-time link from the running server (a window opened again after its window closed).
pub fn fresh_launch_url() -> Option<String> {
    let (_, port, _, data_dir) = INFO.lock().ok()?.clone()?;
    let token = std::fs::read_to_string(data_dir.join("launcher.token")).ok()?.trim().to_string();
    let url = format!("http://127.0.0.1:{port}/launcher/hello?launch=1");
    let body: Value = ureq::get(&url).set("x-ogden-launcher-token", &token).timeout(Duration::from_secs(5)).call().ok()?.into_string().ok().and_then(|s| serde_json::from_str(&s).ok())?;
    body["launchUrl"].as_str().map(|s| s.to_string())
}

pub enum QuitAnswer {
    /// Nothing of ours to stop: the server was already running when the app started.
    NotOurs,
    /// Sessions are working; the server did not stop.
    Busy(u64),
    /// The server stopped, and whatever it left behind was cleaned up.
    Stopped,
}

/// Asks the server it started to quit (`force` after the user confirmed), waits for it, and
/// cleans up anything left. Only ever touches a server this app started.
pub fn quit(force: bool) -> QuitAnswer {
    let Some((owned, port, pid, data_dir)) = INFO.lock().ok().and_then(|g| g.clone()) else { return QuitAnswer::NotOurs };
    if !owned {
        report("quit_not_ours", json!({}));
        return QuitAnswer::NotOurs;
    }
    // What the server started (agents), noted before it goes, so a straggler can be stopped after.
    let mut before = descendants(pid);
    let token = std::fs::read_to_string(data_dir.join("launcher.token")).ok().map(|t| t.trim().to_string());
    let mut asked = false;
    if let Some(token) = token {
        let url = format!("http://127.0.0.1:{port}/launcher/quit");
        let body = if force { "{\"force\":true}" } else { "{}" };
        match ureq::post(&url).set("x-ogden-launcher-token", &token).set("content-type", "application/json").timeout(Duration::from_secs(10)).send_string(body) {
            Ok(_) => asked = true,
            Err(ureq::Error::Status(409, resp)) => {
                let n = resp.into_string().ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).and_then(|v| v["error"]["details"]["busySessions"].as_u64()).unwrap_or(1);
                report("quit_busy", json!({ "busySessions": n }));
                return QuitAnswer::Busy(n);
            }
            Err(e) => report("quit_request_failed", json!({ "error": e.to_string() })),
        }
    }
    // The held launcher ends when the server does; wait for that, then check nothing is left.
    let deadline = Instant::now() + Duration::from_secs(if asked { 20 } else { 1 });
    let mut stopped = false;
    let mut last_note = Instant::now();
    while Instant::now() < deadline {
        let done = LAUNCHER.lock().ok().and_then(|mut g| g.as_mut().map(|c| matches!(c.try_wait(), Ok(Some(_))))).unwrap_or(true);
        if done {
            stopped = true;
            break;
        }
        // An agent or its child that started after the first note (a turn that was starting as Quit came) is ours too:
        // keep noting what is under the server until it is gone, so the sweep below stops it.
        if last_note.elapsed() >= Duration::from_millis(500) {
            last_note = Instant::now();
            for p in descendants(pid) {
                if !before.contains(&p) {
                    before.push(p);
                }
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if !stopped {
        report("quit_timeout", json!({}));
    }
    // What was still running when the sweep began, named for the test report (pids only, nothing secret).
    let alive: Vec<u32> = before.iter().copied().filter(|p| crate::report::pid_alive(*p)).collect();
    cleanup_leftovers(pid, &before);
    report("quit_sweep", json!({ "noted": before.len(), "aliveBeforeSweep": alive }));
    report("server_stopped", json!({ "serverPid": pid, "graceful": stopped }));
    QuitAnswer::Stopped
}

/// The last resort, also run when the app exits: stop the launcher, the server and anything that
/// was noted under it, so nothing outlives the app (a Windows job object does the same for a crash).
fn cleanup_leftovers(server_pid: u32, noted: &[u32]) {
    if let Ok(mut g) = LAUNCHER.lock() {
        if let Some(mut c) = g.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
    if crate::report::pid_alive(server_pid) {
        kill_pid(server_pid);
    }
    for pid in noted {
        if crate::report::pid_alive(*pid) {
            kill_pid(*pid);
        }
    }
}

/// On the way out of the app: leave nothing of ours running. An attached server stays.
pub fn on_exit() {
    let Some((owned, _, pid, _)) = INFO.lock().ok().and_then(|g| g.clone()) else { return };
    if owned {
        let noted = descendants(pid);
        cleanup_leftovers(pid, &noted);
    }
}

/// The launcher token and port of the running server, for the shell's own `/launcher/*` calls.
fn launcher_call_target() -> Option<(u16, String)> {
    let (_, port, _, data_dir) = INFO.lock().ok()?.clone()?;
    let token = std::fs::read_to_string(data_dir.join("launcher.token")).ok()?.trim().to_string();
    Some((port, token))
}

/// The update channel the user chose (`stable` or `next`), kept by the server.
pub fn update_channel() -> String {
    let Some((port, token)) = launcher_call_target() else { return "stable".into() };
    ureq::get(&format!("http://127.0.0.1:{port}/launcher/update-channel"))
        .set("x-ogden-launcher-token", &token)
        .timeout(Duration::from_secs(5))
        .call()
        .ok()
        .and_then(|r| r.into_string().ok())
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v["channel"].as_str().map(|c| c.to_string()))
        .filter(|c| c == "next")
        .unwrap_or_else(|| "stable".into())
}

/// Tells the server about an update (found, downloaded and verified, or failed with a plain reason).
pub fn report_update(version: &str, notes: &str, channel: &str, downloaded: bool, failed: Option<&str>) {
    let Some((port, token)) = launcher_call_target() else { return };
    let mut body = json!({ "version": version, "notes": notes.chars().take(4000).collect::<String>(), "channel": channel, "downloaded": downloaded });
    if let Some(why) = failed {
        body["failed"] = json!(why.chars().take(300).collect::<String>());
    }
    let result = ureq::post(&format!("http://127.0.0.1:{port}/launcher/app-update"))
        .set("x-ogden-launcher-token", &token)
        .set("content-type", "application/json")
        .timeout(Duration::from_secs(5))
        .send_string(&body.to_string());
    if let Err(e) = result {
        report("update_report_failed", json!({ "error": e.to_string() }));
    }
}

/// Whether the user asked to restart and nothing is busy (the server's one busy rule decides).
pub fn restart_go_ahead() -> bool {
    let Some((port, token)) = launcher_call_target() else { return false };
    ureq::get(&format!("http://127.0.0.1:{port}/launcher/app-update"))
        .set("x-ogden-launcher-token", &token)
        .timeout(Duration::from_secs(5))
        .call()
        .ok()
        .and_then(|r| r.into_string().ok())
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .map(|v| v["restart"].as_bool() == Some(true))
        .unwrap_or(false)
}
