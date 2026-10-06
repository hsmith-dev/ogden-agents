// The app updates itself (story 13.10, E13-R6; AD-20, AD-23).
//
// Only on start (and when the user picks Check for Updates in the menu; never periodically) the
// shell asks the signed `latest.json` of the user's channel (stable or next) for a newer version.
// A found update is reported to the server, downloaded in the background, and checked twice before
// anything is installed: the updater verifies the minisign signature against the public key in the
// build, and the shell checks the file's SHA-256 against `SHA256SUMS-desktop.txt` on the same
// release. Only then does the server tell the page "Update available. Restart to update." The page
// asks the server to restart; the server says go only when nothing is busy, and the shell polls for
// that. A failed download, signature, checksum or install keeps the running version and tells the
// page why. Downgrades are refused by the updater. The page never reaches the updater (no IPC).
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Url};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::report::report;
use crate::server;

const STABLE: &str = "https://github.com/hsmith-dev/ogden-agents/releases/latest/download/latest.json";
const NEXT: &str = "https://github.com/hsmith-dev/ogden-agents/releases/download/desktop-channel-next/latest.json";
const SUMS_FILE: &str = "SHA256SUMS-desktop.txt";

/// The verified update waiting for the user's Restart.
static READY: Mutex<Option<(Update, Vec<u8>)>> = Mutex::new(None);

pub enum Outcome {
    /// This build has no updater key (an unsigned release): nothing to check.
    Disabled,
    /// A Linux install that is not an AppImage (the `.deb`): updated by downloading the newest version.
    #[allow(dead_code)]
    NotSelfUpdating,
    UpToDate(String),
    Ready(String),
    Failed(String),
}

fn plugin_config(app: &AppHandle) -> Value {
    app.config().plugins.0.get("updater").cloned().unwrap_or(Value::Null)
}

/// Where this channel's manifest is. A test build (its config allows plain http) can point at a
/// local fake release server with `OGDEN_DESKTOP_TEST_UPDATE_BASE`; a release build never reads it.
fn endpoint(app: &AppHandle, channel: &str) -> Result<Url, String> {
    let insecure_ok = plugin_config(app)["dangerousInsecureTransportProtocol"].as_bool() == Some(true);
    let url = match std::env::var("OGDEN_DESKTOP_TEST_UPDATE_BASE") {
        Ok(base) if insecure_ok => format!("{}/{channel}/latest.json", base.trim_end_matches('/')),
        _ => (if channel == "next" { NEXT } else { STABLE }).to_string(),
    };
    url.parse::<Url>().map_err(|e| e.to_string())
}

/// The SHA-256 the release lists for `download_url`'s file, from the sums file beside it.
fn listed_checksum(download_url: &Url) -> Result<String, String> {
    let name = download_url.path_segments().and_then(|s| s.last()).map(|n| n.to_string()).ok_or("no file name")?;
    let name = percent_decode(&name);
    let mut sums = download_url.clone();
    sums.path_segments_mut().map_err(|_| "bad update address")?.pop().push(SUMS_FILE);
    let text = ureq::get(sums.as_str()).timeout(Duration::from_secs(30)).call().map_err(|e| e.to_string())?.into_string().map_err(|e| e.to_string())?;
    text.lines()
        .filter_map(|l| {
            let (hash, file) = l.split_once("  ")?;
            (file.trim().trim_start_matches('*') == name).then(|| hash.trim().to_lowercase())
        })
        .next()
        .ok_or_else(|| format!("{name} is not in {SUMS_FILE}"))
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Checks the user's channel, and when there is a newer version, downloads and verifies it.
pub async fn check(app: &AppHandle) -> Outcome {
    // Linux: the updater replaces only an AppImage (the file `APPIMAGE` names). An install by the package
    // manager (the .deb) is updated by downloading the newest version, so it does not check (story 13.15).
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPIMAGE").is_none() {
        report("update_not_appimage", json!({}));
        return Outcome::NotSelfUpdating;
    }
    let config = plugin_config(app);
    if config["pubkey"].as_str().unwrap_or("").trim().is_empty() {
        report("update_disabled", json!({ "pluginConfig": config.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()) }));
        return Outcome::Disabled;
    }
    let channel = server::update_channel();
    report("update_check_start", json!({ "channel": channel }));
    let url = match endpoint(app, &channel) {
        Ok(u) => u,
        Err(e) => return Outcome::Failed(e),
    };
    let builder = match app.updater_builder().endpoints(vec![url]) {
        Ok(b) => b,
        Err(e) => return Outcome::Failed(e.to_string()),
    };
    // Windows installs in the background and ends this process, so the installer starts the app again.
    // The installer's own `/R` starts the app again as the user, with none of this process's environment;
    // a CI test build (which reports to a file) leaves that to the relaunch helper below, which keeps it.
    #[cfg(windows)]
    let builder = if std::env::var_os("OGDEN_DESKTOP_TEST_REPORT").is_some() { builder } else { builder.restart_after_install(true).installer_args(["/R"]) };
    let updater = match builder.build() {
        Ok(u) => u,
        Err(e) => return Outcome::Failed(e.to_string()),
    };
    let current = app.package_info().version.to_string();
    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => {
            report("update_none", json!({ "current": current, "channel": channel }));
            return Outcome::UpToDate(current);
        }
        Err(e) => {
            report("update_check_failed", json!({ "error": e.to_string() }));
            return Outcome::Failed(e.to_string());
        }
    };
    let version = update.version.clone();
    let notes = update.body.clone().unwrap_or_default();
    report("update_found", json!({ "version": version, "channel": channel }));
    server::report_update(&version, &notes, &channel, false, None);

    let fail = |why: &str| {
        report("update_failed", json!({ "version": version, "why": why }));
        server::report_update(&version, &notes, &channel, false, Some(why));
        Outcome::Failed(why.to_string())
    };
    // The updater checks the minisign signature while downloading.
    let bytes = match update.download(|_, _| {}, || {}).await {
        Ok(b) => b,
        Err(e) => {
            let text = e.to_string();
            return fail(if text.to_lowercase().contains("signature") { "Its signature did not check out." } else { "It could not be downloaded." });
        }
    };
    let download_url = update.download_url.clone();
    let listed = tauri::async_runtime::spawn_blocking(move || listed_checksum(&download_url)).await;
    let expected = match listed {
        Ok(Ok(h)) => h,
        _ => return fail("Its checksum could not be read from the release."),
    };
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if actual != expected {
        return fail("Its checksum did not match the release's list.");
    }
    report("update_downloaded", json!({ "version": version }));
    server::report_update(&version, &notes, &channel, true, None);
    if let Ok(mut g) = READY.lock() {
        *g = Some((update, bytes));
    }
    watch_for_restart(app.clone());
    Outcome::Ready(version)
}

/// Waits for the server to say the user asked to restart and nothing is busy, then installs.
fn watch_for_restart(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        if crate::ui::quitting() {
            return;
        }
        if server::restart_go_ahead() {
            install_now(&app);
            return;
        }
    });
}

fn install_now(app: &AppHandle) {
    let Some((update, bytes)) = READY.lock().ok().and_then(|mut g| g.take()) else { return };
    report("update_installing", json!({ "version": update.version }));
    crate::ui::begin_quit();
    // The server stops first (its agents with it); Windows' installer ends this process.
    server::quit(true);
    #[cfg(windows)]
    relaunch_after_install(&update.version);
    #[cfg(windows)]
    let installed = run_installer(&bytes, &update.version);
    #[cfg(not(windows))]
    let installed = update.install(&bytes).map_err(|e| e.to_string());
    match installed {
        Ok(()) => {
            app.restart();
        }
        Err(e) => {
            report("update_install_failed", json!({ "error": e }));
            let app2 = app.clone();
            app.dialog()
                .message("Ogden Agents could not install the update. The version you have is opened again.")
                .title("Update")
                .kind(MessageDialogKind::Error)
                .blocking_show();
            app2.restart();
        }
    }
}

/// The menu's Check for Updates: a user action, so it answers in a dialog.
pub async fn check_for_user(app: AppHandle) {
    let outcome = check(&app).await;
    let (text, kind) = match outcome {
        Outcome::Disabled => ("This build of Ogden Agents does not update itself. Download the newest version from the releases page.".to_string(), MessageDialogKind::Info),
        Outcome::NotSelfUpdating => ("This install of Ogden Agents is updated through your package manager or by downloading the newest version from the releases page: github.com/hsmith-dev/ogden-agents/releases/latest".to_string(), MessageDialogKind::Info),
        Outcome::UpToDate(v) => (format!("Ogden Agents {v} is up to date."), MessageDialogKind::Info),
        Outcome::Ready(v) => (format!("Ogden Agents {v} is ready. Choose Restart to update in the app."), MessageDialogKind::Info),
        Outcome::Failed(why) => (format!("Ogden Agents could not check for updates. {why}"), MessageDialogKind::Warning),
    };
    let app2 = app.clone();
    std::thread::spawn(move || {
        app2.dialog().message(text).title("Check for Updates").kind(kind).blocking_show();
    });
}

/// Windows: the installer ends this process, and it starts the app again only through its own `/R`
/// flag (as the user, without this process's environment). A small helper outside this app's job
/// waits until the installed program is the new version and the installer has finished, and, if nothing started it, starts it. Both
/// ways at once are safe: a second start is handed to the first by the single-instance plugin.
#[cfg(windows)]
fn relaunch_after_install(version: &str) {
    use std::os::windows::process::CommandExt;
    let Ok(exe) = std::env::current_exe() else { return };
    // A test build (which reports to a file) also leaves a small log beside it, so a CI failure shows what the installer did.
    let script = format!(
        "$exe = '{exe}'; $target = '{version}'; $log = $env:OGDEN_DESKTOP_TEST_REPORT; \
         function Note($t) {{ if ($log) {{ Add-Content -LiteralPath ($log + '.helper.log') -Value ((Get-Date -Format o) + ' ' + $t) }} }}; \
         Note 'helper started'; \
         for ($i = 0; $i -lt 300; $i++) {{ Start-Sleep -Seconds 1; try {{ $v = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion }} catch {{ $v = '' }}; \
           if ($i % 5 -eq 0) {{ Note ('version ' + $v + '; ' + ((Get-Process | Where-Object {{ $_.Name -match 'ogden|setup|nsis|msiexec' }} | ForEach-Object {{ $_.Name }}) -join ',')) }}; \
           if ($v -like \"$target*\") {{ break }} }}; \
         for ($j = 0; $j -lt 120; $j++) {{ if (-not (Get-Process -Name 'ogden-agents-update-*' -ErrorAction SilentlyContinue)) {{ break }}; Start-Sleep -Seconds 1 }}; \
         Start-Sleep -Seconds 3; \
         if (-not (Get-Process -Name 'ogden-agents' -ErrorAction SilentlyContinue)) {{ Note 'starting the app'; Start-Process -FilePath $exe }} else {{ Note 'the app is already running' }}",
        exe = exe.display().to_string().replace('\'', "''"),
        version = version.replace('\'', "''"),
    );
    // CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB: the app's kill-on-close job would otherwise end it with the app.
    let result = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &script])
        .creation_flags(0x0800_0000 | 0x0100_0000)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
    report("update_relaunch_helper", json!({ "started": result.is_ok() }));
}

/// Windows: runs the downloaded installer (already checked against the signature and the checksum)
/// silently over the current install, as a first install runs, then ends this process so the installer
/// can replace its files. The updater plugin's own passive launch left the installer not running in CI
/// (spike 13.1 saw no relaunch either), and a silent install has no window that can wait for a person.
#[cfg(windows)]
fn run_installer(bytes: &[u8], version: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("no install folder")?.to_path_buf();
    let installer = std::env::temp_dir().join(format!("ogden-agents-update-{}-setup.exe", version.replace(|c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '-'), "_")));
    std::fs::write(&installer, bytes).map_err(|e| format!("could not save the installer: {e}"))?;
    let mut cmd = std::process::Command::new(&installer);
    // `/D=` must be last and is never quoted (NSIS).
    cmd.args(["/S", "/UPDATE"]);
    // The installer's own `/R` starts the new version as the user; a test build leaves that to the relaunch helper, which keeps the test's environment.
    if std::env::var_os("OGDEN_DESKTOP_TEST_REPORT").is_none() {
        cmd.arg("/R");
    }
    cmd.raw_arg(format!("/D={}", dir.display()));
    // CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB: the installer must outlive this app and its job.
    cmd.creation_flags(0x0800_0000 | 0x0100_0000).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    cmd.spawn().map_err(|e| format!("could not start the installer: {e}"))?;
    report("update_installer_started", json!({}));
    // The installer replaces this program's files: leave now.
    std::process::exit(0);
}
