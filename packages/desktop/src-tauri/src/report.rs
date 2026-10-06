// The shell's test hook and process helpers (story 13.5). Test builds in CI set
// `OGDEN_DESKTOP_TEST_REPORT` to a file and the shell appends one JSON line per event; nothing
// secret is ever written (no launch link, no token, no data path of a secret).
use std::fs::OpenOptions;
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// One writer at a time: the page-load callback and the update thread both report, and two appends at once tore a line on Windows.
static WRITE: Mutex<()> = Mutex::new(());

pub fn report(ev: &str, data: Value) {
    let Some(path) = std::env::var_os("OGDEN_DESKTOP_TEST_REPORT") else { return };
    let line = json!({ "t": now_ms(), "ev": ev, "pid": std::process::id(), "data": data }).to_string();
    let _guard = WRITE.lock();
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(format!("{line}\n").as_bytes());
    }
}

/// The process ids below `root` (children, grandchildren, ...), found with `ps`. Empty where
/// there is no `ps` or on Windows (a job object handles the tree there).
#[cfg(unix)]
pub fn descendants(root: u32) -> Vec<u32> {
    let Ok(out) = Command::new("ps").args(["-axo", "pid=,ppid="]).stdin(Stdio::null()).stderr(Stdio::null()).output() else { return vec![] };
    let text = String::from_utf8_lossy(&out.stdout);
    let pairs: Vec<(u32, u32)> = text
        .lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?))
        })
        .collect();
    let mut found = vec![];
    let mut frontier = vec![root];
    while let Some(parent) = frontier.pop() {
        for (pid, ppid) in &pairs {
            if *ppid == parent && !found.contains(pid) {
                found.push(*pid);
                frontier.push(*pid);
            }
        }
    }
    found
}

#[cfg(windows)]
pub fn descendants(_root: u32) -> Vec<u32> {
    vec![]
}

/// Stops `pid` and what it started: its process group where it leads one, and the pid itself.
#[cfg(unix)]
pub fn kill_pid(pid: u32) {
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
        libc::kill(pid as i32, libc::SIGKILL);
    }
}

#[cfg(windows)]
pub fn kill_pid(pid: u32) {
    use std::os::windows::process::CommandExt;
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let _ = Command::new(std::path::PathBuf::from(root).join("System32").join("taskkill.exe"))
        .args(["/pid", &pid.to_string(), "/T", "/F"])
        .creation_flags(0x0800_0000)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(unix)]
pub fn pid_alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, 0) == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM) }
}

#[cfg(windows)]
pub fn pid_alive(pid: u32) -> bool {
    use std::os::windows::process::CommandExt;
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    Command::new(std::path::PathBuf::from(root).join("System32").join("tasklist.exe"))
        .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
        .creation_flags(0x0800_0000)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(&format!("\"{pid}\"")))
        .unwrap_or(false)
}
