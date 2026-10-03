"""Spike 5.1 (temporary): probe bmad-loop as Ogden's build driver, and the OS
behaviour epic 5 rests on, on the CI runner this runs on.

    python probe.py pre    # install, sandboxes, worktrees, v7 and no-multiplexer runs
    python probe.py post   # after the workflow installed a multiplexer: happy run, stop

Stdlib only. Never fails on a "no": every answer is recorded in
<data>/results-<os>.json and the step summary. No secrets, no real agent.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
PIN = "6bbe469637e2b8ac490b1f8c085aed8e2b19ce1b"
SOURCE = f"bmad-loop @ git+https://github.com/bmad-code-org/bmad-loop@{PIN}"
WIN = sys.platform == "win32"
OS = {"win32": "windows", "darwin": "macos"}.get(sys.platform, "linux")
TEMP = Path(os.environ.get("RUNNER_TEMP") or os.environ.get("TMPDIR") or "/tmp").resolve()
# Ogden's data folder, as env-paths would place it (deep on purpose).
if WIN:
    DATA = Path(os.environ["LOCALAPPDATA"]) / "ogden-agents-spike" / "Data"
else:
    DATA = TEMP / "ogden-agents-spike" / "Data"
WS_ID = "01K6SPIKE5PROBEWORKSPACE01"
RUN_ULID = "01K6SPIKE5PROBERUNIDENT001"
SLUG = "1.1-probe-the-build-driver-and-os-behaviour"
PLAN_REL = "_bmad-output/initiative-ogden-agents/epic-unattended-builds/spike-probe-the-build-driver-and-os-behaviour-in-ci-plan.md"
SPEC_FOLDER = "_bmad-output/initiative-probe/epic-probe"
VENV = DATA / "tools" / "bmad-loop" / PIN
STATE = DATA / "bmad-loop-state"
RESULTS = DATA / f"results-{OS}.json"
MARKERS = DATA / "markers"
PROJECT = TEMP / "spike-project"


def bl_exe(venv: Path = VENV) -> str:
    return str(venv / ("Scripts/bmad-loop.exe" if WIN else "bin/bmad-loop"))


def run(cmd, timeout=300, cwd=None, env=None, check_text=True) -> dict:
    t0 = time.monotonic()
    try:
        p = subprocess.run(
            [str(c) for c in cmd], cwd=cwd, env=env, capture_output=True, text=True,
            timeout=timeout, encoding="utf-8", errors="replace",
        )
        return {"cmd": " ".join(map(str, cmd))[-400:], "rc": p.returncode, "secs": round(time.monotonic() - t0, 2),
                "out": p.stdout[-4000:], "err": p.stderr[-4000:]}
    except subprocess.TimeoutExpired as e:
        return {"cmd": " ".join(map(str, cmd))[-400:], "rc": "timeout", "secs": timeout,
                "out": (e.stdout or "")[-4000:] if isinstance(e.stdout, str) else "",
                "err": (e.stderr or "")[-4000:] if isinstance(e.stderr, str) else ""}
    except Exception as e:  # noqa: BLE001
        return {"cmd": " ".join(map(str, cmd))[-400:], "rc": "error", "err": repr(e)}


def git(*args, cwd=None, timeout=120) -> dict:
    return run(["git", *args], cwd=cwd, timeout=timeout)


def load() -> dict:
    return json.loads(RESULTS.read_text(encoding="utf-8")) if RESULTS.exists() else {"os": OS}


def save(res: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    RESULTS.write_text(json.dumps(res, indent=2), encoding="utf-8")
    copy = TEMP / "spike-results"
    copy.mkdir(parents=True, exist_ok=True)
    (copy / RESULTS.name).write_text(json.dumps(res, indent=2), encoding="utf-8")


def step(res: dict, name: str, fn) -> None:
    print(f"== {name}", flush=True)
    try:
        res[name] = fn()
    except Exception:  # noqa: BLE001
        res[name] = {"exception": traceback.format_exc()[-3000:]}
    save(res)
    print(json.dumps(res[name], indent=1)[:3000], flush=True)


def bl_env(**extra) -> dict:
    env = dict(os.environ)
    env["BMAD_LOOP_STATE_DIR"] = str(STATE)
    env["BMAD_LOOP_SESSION_TIMEOUT_S"] = "150"
    env["PYTHONUTF8"] = "1"
    env.update(extra)
    return env


def alive(pid) -> bool:
    if not pid:
        return False
    if WIN:
        out = run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], timeout=30).get("out", "")
        return str(pid) in out
    try:
        os.kill(int(pid), 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def dir_size(p: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(p):
        for f in files:
            try:
                total += os.lstat(os.path.join(root, f)).st_size
            except OSError:
                pass
    return total


def listing(p: Path, limit=80) -> list[str]:
    out = []
    if p.exists():
        for root, _dirs, files in os.walk(p):
            for f in files:
                out.append(os.path.relpath(os.path.join(root, f), p).replace("\\", "/"))
                if len(out) >= limit:
                    return out
    return out


# ---------------------------------------------------------------- pre phase


def host_info() -> dict:
    info = {
        "platform": sys.platform, "python": sys.version.split()[0],
        "git": run(["git", "--version"])["out"].strip(),
        "git_longpaths_config": run(["git", "config", "--show-origin", "--get-all", "core.longpaths"])["out"].strip(),
        "uv": run(["uv", "--version"])["out"].strip(),
        "uv_default_cache_dir": run(["uv", "cache", "dir"])["out"].strip(),
        "node": run(["node", "--version"])["out"].strip(),
        "data_dir": str(DATA), "data_dir_len": len(str(DATA)),
    }
    if WIN:
        info["LongPathsEnabled"] = run(["reg", "query", r"HKLM\SYSTEM\CurrentControlSet\Control\FileSystem", "/v", "LongPathsEnabled"])["out"].strip()
        info["pwsh"] = shutil.which("pwsh")
    for tool in ("tmux", "psmux", "sandbox-exec", "bwrap", "socat", "docker", "wsl"):
        info[f"which_{tool}"] = shutil.which(tool)
    return info


def install_bmad_loop() -> dict:
    """Mirror story 4.14's createBmadLoopResolver: uv venv + uv pip install with the
    lock's build constraint, into <data>/tools/bmad-loop/<commit>; cold, then warm."""
    out = {}
    cache = DATA / "uv-cache"
    shutil.rmtree(cache, ignore_errors=True)
    constraints = DATA / "build-constraints.txt"
    DATA.mkdir(parents=True, exist_ok=True)
    constraints.write_text("hatchling==1.32.4\n", encoding="utf-8")
    env = dict(os.environ, UV_CACHE_DIR=str(cache))
    for label, venv in (("cold", VENV), ("warm", DATA / "tools" / "bmad-loop" / "warm-check")):
        shutil.rmtree(venv, ignore_errors=True)
        a = run(["uv", "venv", "--no-config", "--quiet", venv], env=env)
        b = run(["uv", "pip", "install", "--no-config", "--quiet", "--python", venv, "--build-constraints", constraints, SOURCE], env=env, timeout=600)
        out[label] = {"venv_rc": a["rc"], "install_rc": b["rc"], "secs": round(a.get("secs", 0) + b.get("secs", 0), 2),
                      "err": b.get("err", "")[-1500:], "exe_exists": Path(bl_exe(venv)).exists()}
    out["cache_bytes"] = dir_size(cache)
    out["venv_bytes"] = dir_size(VENV)
    # Offline reuse: a third venv with --offline proves the cache alone suffices.
    off = DATA / "tools" / "bmad-loop" / "offline-check"
    run(["uv", "venv", "--no-config", "--quiet", off], env=env)
    o = run(["uv", "pip", "install", "--no-config", "--quiet", "--offline", "--python", off, "--build-constraints", constraints, SOURCE], env=env)
    out["offline_reinstall"] = {"rc": o["rc"], "err": o["err"][-800:]}
    for v in ("warm-check", "offline-check"):
        shutil.rmtree(DATA / "tools" / "bmad-loop" / v, ignore_errors=True)
    out["version"] = run([bl_exe(), "--version"])["out"].strip()
    out["mux"] = run([bl_exe(), "mux"], env=bl_env())
    out["process_host_default"] = run([str(VENV / ("Scripts/python.exe" if WIN else "bin/python")), "-c",
                                       "from bmad_loop import process_host as p; print(type(p.get_process_host()).__name__ if hasattr(p,'get_process_host') else [n for n in dir(p) if 'Host' in n])"])["out"].strip()
    return out


def sandboxes() -> dict:
    s = {}
    if OS == "macos":
        s["sandbox_exec_allow"] = run(["/usr/bin/sandbox-exec", "-p", "(version 1)(allow default)", "/usr/bin/true"])
        deny = TEMP / "sbx-deny"
        deny.mkdir(exist_ok=True)
        prof = f'(version 1)(allow default)(deny file-write* (subpath "{deny}"))'
        r = run(["/usr/bin/sandbox-exec", "-p", prof, "/usr/bin/touch", str(deny / "x")])
        s["sandbox_exec_denies_write"] = {"rc": r["rc"], "err": r.get("err", ""), "file_created": (deny / "x").exists()}
        s["sw_vers"] = run(["sw_vers"])["out"]
    if OS == "linux":
        s["lsm"] = run(["cat", "/sys/kernel/security/lsm"])["out"].strip()
        s["apparmor_restrict_userns"] = run(["sysctl", "-n", "kernel.apparmor_restrict_unprivileged_userns"])
        s["unshare_user"] = run(["unshare", "-Ur", "true"])
        s["bwrap_version"] = run(["bwrap", "--version"])
        if not shutil.which("bwrap"):
            s["bwrap_install"] = run(["sudo", "apt-get", "install", "-y", "-q", "bubblewrap"], timeout=240)
        s["bwrap_ro_root"] = run(["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--unshare-net", "true"])
        s["socat"] = shutil.which("socat")
        s["landlock_abi"] = run([sys.executable, "-c",
                                 "import ctypes,os;libc=ctypes.CDLL(None,use_errno=True);print(libc.syscall(444,None,0,1))"])
        s["os_release"] = run(["cat", "/etc/os-release"])["out"][:300]
    if WIN:
        s["appcontainer"] = "not probed (document only): no CLI; Claude Code ships no Windows sandbox"
        s["wsl"] = run(["wsl", "--status"], timeout=60)
        s["ver"] = run(["cmd", "/c", "ver"])["out"].strip()
    s["docker_ostype"] = run(["docker", "info", "--format", "{{.OSType}} {{.ServerVersion}}"], timeout=90)
    return s


def worktree_paths() -> dict:
    """git worktree add/remove outside the repo at a deep data-folder path."""
    out = {}
    repo = TEMP / "wt-repo"
    shutil.rmtree(repo, ignore_errors=True)
    repo.mkdir(parents=True)
    git("init", "-q", "-b", "main", cwd=repo)
    git("config", "user.email", "spike@test", cwd=repo)
    git("config", "user.name", "spike", cwd=repo)
    deep = repo / PLAN_REL
    deep.parent.mkdir(parents=True, exist_ok=True)
    deep.write_text("plan\n", encoding="utf-8")
    deeper = repo / "packages" / "web" / "src" / "components" / "ticket-detail-sheet" / "verification-checks-and-review-findings" / "approve-and-merge-dialog.test-fixtures.json"
    deeper.parent.mkdir(parents=True, exist_ok=True)
    deeper.write_text("{}\n", encoding="utf-8")
    git("add", "-A", cwd=repo)
    out["commit"] = git("-c", "core.longpaths=true", "commit", "-q", "-m", "init", cwd=repo)["rc"]
    for lp in ("false", "true"):
        wt = DATA / "worktrees" / WS_ID / f"{RUN_ULID}-{SLUG}-lp{lp}"
        shutil.rmtree(wt, ignore_errors=True)
        add = git("-c", f"core.longpaths={lp}", "worktree", "add", "-b", f"ogden/{SLUG}-{lp}", str(wt), cwd=repo)
        st = git("-c", f"core.longpaths={lp}", "status", "--porcelain", cwd=wt) if wt.exists() else {"rc": "no-dir"}
        rm = git("-c", f"core.longpaths={lp}", "worktree", "remove", str(wt), cwd=repo)
        leftover = wt.exists()
        prune = git("worktree", "prune", cwd=repo)
        out[f"longpaths_{lp}"] = {
            "worktree_len": len(str(wt)), "deepest_file_len": len(str(wt / deeper.relative_to(repo))),
            "plan_file_len": len(str(wt / PLAN_REL)),
            "add_rc": add["rc"], "add_err": add["err"][-1200:], "status_rc": st["rc"], "status_out": st.get("out", "")[:500],
            "remove_rc": rm["rc"], "remove_err": rm.get("err", "")[-800:], "dir_left_after_remove": leftover,
            "prune_rc": prune["rc"],
        }
        shutil.rmtree(wt, ignore_errors=True)
    out["main_status_after"] = git("status", "--porcelain", cwd=repo)["out"]
    out["branches_after"] = git("branch", "--list", "ogden/*", cwd=repo)["out"]
    out["worktree_list_after"] = git("worktree", "list", cwd=repo)["out"]
    return out


def write(p: Path, text: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def scaffold_project() -> dict:
    """A fake user repo: a v7 ticket tree, the stories-mode equivalent of its one
    ticket (what an Ogden adapter would have to synthesise), and skill stubs."""
    shutil.rmtree(PROJECT, ignore_errors=True)
    PROJECT.mkdir(parents=True)
    write(PROJECT / "src.txt", "original\n")
    write(PROJECT / "_bmad" / "bmm" / "config.yaml",
          "implementation_artifacts: '{project-root}/_bmad-output/implementation-artifacts'\n"
          "planning_artifacts: '{project-root}/_bmad-output/planning-artifacts'\n")
    for sub in ("implementation-artifacts", "planning-artifacts"):
        write(PROJECT / "_bmad-output" / sub / ".keep", "")
    # v7 ticket tree (initiative + epic tickets.toml), as Ogden's boards read it.
    write(PROJECT / "_bmad-output/initiative-probe/tickets.toml",
          '[[epic]]\nid = 1\nfolder = "epic-probe"\ntitle = "Probe"\n')
    write(PROJECT / SPEC_FOLDER / "tickets.toml",
          '[[ticket]]\nid = 1\ntype = "story"\ntitle = "Probe the build driver"\n'
          'description = "Append a line to src.txt."\nverify = "src.txt has the line."\nhitl = false\n')
    write(PROJECT / SPEC_FOLDER / "epic-probe.md", "---\ntype: epic\ntitle: Probe\n---\n# Probe\n")
    # Stories-mode twin of the same ticket (bmad-loop 0.13.0 has no v7 reader).
    write(PROJECT / SPEC_FOLDER / "SPEC.md", "---\ntitle: Probe\n---\n# Probe\n")
    write(PROJECT / SPEC_FOLDER / "stories.yaml",
          '- id: "1"\n  title: Probe the build driver\n  description: Append a line to src.txt.\n')
    write(PROJECT / SPEC_FOLDER / "stories" / ".keep", "")
    sk = PROJECT / ".claude" / "skills"
    for name, markers in {"bmad-build-auto": ("step-04-review.md", "customize.toml"),
                          "bmad-review-adversarial-general": (), "bmad-review-edge-case-hunter": ()}.items():
        write(sk / name / "SKILL.md", f"# {name}\n")
        for m in markers:
            write(sk / name / m, "x\n")
    write(sk / "bmad-build-auto" / "step-01-clarify-and-route.md", "This is a **folder+id dispatch** router.\n")
    git("init", "-q", "-b", "main", cwd=PROJECT)
    git("config", "user.email", "spike@test", cwd=PROJECT)
    git("config", "user.name", "spike", cwd=PROJECT)
    git("config", "core.longpaths", "true", cwd=PROJECT)
    git("add", "-A", cwd=PROJECT)
    c = git("commit", "-q", "-m", "fake project", cwd=PROJECT)
    # Ogden writes nothing tracked: bmad-loop's folder is ignored through the
    # repo's info/exclude, which git shares with every linked worktree.
    exclude = PROJECT / ".git" / "info" / "exclude"
    with open(exclude, "a", encoding="utf-8") as f:
        f.write("\n.bmad-loop/\n")
    return {"commit_rc": c["rc"], "head": git("rev-parse", "HEAD", cwd=PROJECT)["out"].strip()}


def profile_toml(mode: str) -> str:
    return (
        'name = "fakeagent"\n'
        f"binary = {json.dumps(sys.executable)}\n"
        f"launch_args = [{json.dumps(str(HERE / 'fake_agent.py'))}, \"--mode\", \"{mode}\", \"--marker\", {json.dumps(str(MARKERS))}]\n"
        'bypass_args = []\nusage_parser = "none"\nskill_tree = ".claude/skills"\n\n'
        '[hooks]\ndialect = "claude-settings-json"\nconfig_path = ".claude/settings.json"\n'
        'events = { SessionStart = "SessionStart", Stop = "Stop" }\n'
    )


def ogden_worktree(suffix: str, mode: str, stories: bool = True) -> Path:
    """What VcsPort would do: a worktree in the data folder on ogden/<ref>-<slug>,
    plus bmad-loop's policy and profile written into it (ignored, never committed)."""
    wt = DATA / "worktrees" / WS_ID / f"{RUN_ULID[:-1]}{suffix}-{SLUG}"
    if wt.exists():
        git("worktree", "remove", "--force", str(wt), cwd=PROJECT)
        shutil.rmtree(wt, ignore_errors=True)
    git("worktree", "prune", cwd=PROJECT)
    r = git("worktree", "add", "-b", f"ogden/{SLUG}-{suffix}", str(wt), cwd=PROJECT)
    if r["rc"] != 0:
        raise RuntimeError(f"worktree add failed: {r}")
    write(wt / ".bmad-loop" / "profiles" / "fakeagent.toml", profile_toml(mode))
    pol = '[adapter]\nname = "fakeagent"\n\n[review]\nenabled = false\n\n[scm]\nisolation = "none"\n'
    if stories:
        pol += f'\n[stories]\nsource = "stories"\nspec_folder = "{SPEC_FOLDER}"\n'
    write(wt / ".bmad-loop" / "policy.toml", pol)
    return wt


def v7_and_validate() -> dict:
    out = {}
    wt = ogden_worktree("v", "done", stories=False)
    out["sprint_mode_no_sprint_status"] = run([bl_exe(), "run", "--project", wt, "--dry-run", "--story", "1"], env=bl_env(), timeout=120)
    out["stories_mode_on_v7_folder_without_stories_yaml"] = run(
        [bl_exe(), "run", "--project", wt, "--dry-run", "--spec", "_bmad-output/initiative-probe", "--story", "1"], env=bl_env(), timeout=120)
    wt2 = ogden_worktree("s", "done")
    out["stories_dry_run_one_named_story"] = run([bl_exe(), "run", "--project", wt2, "--dry-run", "--story", "1"], env=bl_env(), timeout=120)
    out["validate_stub_skills"] = run([bl_exe(), "validate", "--project", wt2, "--json"], env=bl_env(), timeout=180)
    # The real v7 skills this repo ships: does bmad-loop's stories preflight accept them?
    real = TEMP / "real-skills-project"
    shutil.rmtree(real, ignore_errors=True)
    shutil.copytree(PROJECT, real, ignore=shutil.ignore_patterns(".git"))
    shutil.rmtree(real / ".claude" / "skills", ignore_errors=True)
    for s in ("bmad-build-auto", "bmad-review", "bmad-code-review"):
        if (REPO_ROOT / ".claude" / "skills" / s).exists():
            shutil.copytree(REPO_ROOT / ".claude" / "skills" / s, real / ".claude" / "skills" / s)
    if (REPO_ROOT / "_bmad").exists():
        shutil.copytree(REPO_ROOT / "_bmad", real / "_bmad", dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("render", "__pycache__"))
    write(real / ".bmad-loop" / "policy.toml", (wt2 / ".bmad-loop" / "policy.toml").read_text(encoding="utf-8"))
    write(real / ".bmad-loop" / "profiles" / "fakeagent.toml", profile_toml("done"))
    write(real / ".gitignore", ".bmad-loop/\n")
    git("init", "-q", "-b", "main", cwd=real)
    git("-c", "user.email=s@t", "-c", "user.name=s", "add", "-A", cwd=real)
    git("-c", "user.email=s@t", "-c", "user.name=s", "commit", "-q", "-m", "x", cwd=real)
    out["validate_real_v7_skills"] = run([bl_exe(), "validate", "--project", real, "--json"], env=bl_env(), timeout=180)
    out["real_v7_dry_run"] = run([bl_exe(), "run", "--project", real, "--dry-run", "--story", "1"], env=bl_env(), timeout=120)
    return out


def no_mux_run() -> dict:
    if shutil.which("tmux" if not WIN else "psmux"):
        return {"skipped": "a multiplexer is already on this runner"}
    wt = ogden_worktree("n", "done")
    r = run([bl_exe(), "run", "--project", wt, "--story", "1"], env=bl_env(), timeout=240)
    r["agent_markers"] = sorted(p.name for p in MARKERS.glob("agent-*.json")) if MARKERS.exists() else []
    r["run_files"] = listing(wt / ".bmad-loop" / "runs", 30)
    return r


# ---------------------------------------------------------------- post phase


def happy_run() -> dict:
    shutil.rmtree(MARKERS, ignore_errors=True)
    wt = ogden_worktree("h", "done")
    before_main = git("status", "--porcelain", "--ignored", cwd=PROJECT)["out"]
    r = run([bl_exe(), "run", "--project", wt, "--story", "1"], env=bl_env(), timeout=420)
    out = {"run": r, "worktree": str(wt), "worktree_len": len(str(wt))}
    runs_dir = wt / ".bmad-loop" / "runs"
    run_ids = sorted(p.name for p in runs_dir.iterdir()) if runs_dir.exists() else []
    out["run_ids"] = run_ids
    if run_ids:
        rd = runs_dir / run_ids[-1]
        out["run_dir_files"] = listing(rd, 80)
        out["run_dir_max_path_len"] = max((len(str(rd / f)) for f in out["run_dir_files"]), default=0)
        j = rd / "journal.jsonl"
        if j.exists():
            kinds: dict[str, int] = {}
            sample = []
            for line in j.read_text(encoding="utf-8", errors="replace").splitlines():
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                k = str(e.get("event") or e.get("kind") or e.get("type") or "?")
                kinds[k] = kinds.get(k, 0) + 1
                if len(sample) < 6:
                    sample.append(e)
            out["journal_kinds"] = kinds
            out["journal_sample"] = sample
        st = rd / "state.json"
        if st.exists():
            sj = json.loads(st.read_text(encoding="utf-8"))
            out["state_keys"] = sorted(sj.keys())[:60]
            out["state_status"] = {k: sj.get(k) for k in ("status", "finished", "stopped", "paused", "phase") if k in sj}
        out["status_json"] = run([bl_exe(), "status", "--project", wt, "--json"], env=bl_env(), timeout=60)
        out["status_json"]["out"] = out["status_json"]["out"][:3000]
    out["state_root_files"] = listing(STATE, 40)
    out["agent_markers"] = []
    for m in sorted(MARKERS.glob("agent-*.json")) if MARKERS.exists() else []:
        d = json.loads(m.read_text(encoding="utf-8"))
        d.pop("path_env", None)
        out["agent_markers"].append(d)
    out["story_specs"] = {p.name: p.read_text(encoding="utf-8")[:200] for p in (wt / SPEC_FOLDER / "stories").glob("*.md")}
    out["worktree_git_log"] = git("log", "--oneline", "-5", cwd=wt)["out"]
    out["worktree_branch"] = git("branch", "--show-current", cwd=wt)["out"].strip()
    out["worktree_status"] = git("status", "--porcelain", cwd=wt)["out"]
    out["main_checkout_status_before"] = before_main
    out["main_checkout_status_after"] = git("status", "--porcelain", "--ignored", cwd=PROJECT)["out"]
    out["main_checkout_head_moved"] = git("rev-parse", "HEAD", cwd=PROJECT)["out"].strip()
    home_state = Path.home() / (".local/state/bmad-loop" if not WIN else "AppData/Local/bmad-loop")
    out["default_state_root_touched"] = home_state.exists()
    rm = git("worktree", "remove", str(wt), cwd=PROJECT)
    out["worktree_remove"] = {"rc": rm["rc"], "err": rm["err"][-600:]}
    if rm["rc"] != 0:
        rf = git("worktree", "remove", "--force", str(wt), cwd=PROJECT)
        out["worktree_remove_force"] = {"rc": rf["rc"], "err": rf["err"][-600:], "dir_left": wt.exists()}
    out["branch_kept"] = git("branch", "--list", f"ogden/{SLUG}-h", cwd=PROJECT)["out"].strip()
    return out


def spawn_detached(cmd, env) -> subprocess.Popen:
    log = open(DATA / f"stop-{int(time.time())}.log", "w", encoding="utf-8")
    kw = {"stdout": log, "stderr": subprocess.STDOUT, "env": env}
    if WIN:
        kw["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    else:
        kw["start_new_session"] = True
    return subprocess.Popen([str(c) for c in cmd], **kw)


def wait_marker(timeout=150) -> dict | None:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        ms = sorted(MARKERS.glob("agent-*.json")) if MARKERS.exists() else []
        if ms:
            time.sleep(1)
            return json.loads(ms[-1].read_text(encoding="utf-8"))
        time.sleep(1)
    return None


def stop_probe(variant: str) -> dict:
    """variant 'kill': killProcessTree on the bmad-loop pid, then bmad-loop stop.
    variant 'stop': bmad-loop stop first."""
    shutil.rmtree(MARKERS, ignore_errors=True)
    wt = ogden_worktree("k" if variant == "kill" else "t", "hang")
    proc = spawn_detached([bl_exe(), "run", "--project", wt, "--story", "1"], bl_env())
    m = wait_marker()
    out = {"bmad_loop_pid": proc.pid, "agent_started": m is not None}
    if not m:
        proc.kill()
        out["log"] = sorted(DATA.glob("stop-*.log"))[-1].read_text(encoding="utf-8")[-2000:]
        return out
    out["agent_pid"], out["agent_child_pid"] = m["pid"], m["child_pid"]
    out["agent_is_child_of_bmad_loop"] = m["ppid"] == proc.pid
    run_id = sorted(p.name for p in (wt / ".bmad-loop" / "runs").iterdir())[-1]
    out["run_id"] = run_id
    t0 = time.monotonic()
    if variant == "kill":
        k = run(["node", HERE / "kill_tree.mjs", proc.pid], timeout=60)
        out["kill_tree"] = {"rc": k["rc"], "err": k["err"][-500:]}
        time.sleep(3)
        out["after_kill"] = {"bmad_loop": proc.poll() is None and alive(proc.pid), "agent": alive(m["pid"]), "agent_child": alive(m["child_pid"])}
    s = run([bl_exe(), "stop", run_id, "--project", wt], env=bl_env(), timeout=120)
    out["bmad_loop_stop"] = {"rc": s["rc"], "out": s["out"][-800:], "err": s["err"][-800:], "secs": s.get("secs")}
    time.sleep(3)
    out["after_stop"] = {"bmad_loop": proc.poll() is None, "agent": alive(m["pid"]), "agent_child": alive(m["child_pid"]),
                         "secs_since_first_signal": round(time.monotonic() - t0, 1)}
    c = run([bl_exe(), "cleanup", "--project", wt, "--json"], env=bl_env(), timeout=120)
    out["cleanup"] = {"rc": c["rc"], "out": c["out"][-800:], "err": c["err"][-500:]}
    time.sleep(2)
    out["after_cleanup"] = {"agent": alive(m["pid"]), "agent_child": alive(m["child_pid"])}
    st = run([bl_exe(), "status", run_id, "--project", wt, "--json"], env=bl_env(), timeout=60)
    out["status_after"] = st["out"][:1500]
    for pid in (m["pid"], m["child_pid"], proc.pid):  # leave nothing behind
        if alive(pid):
            run(["node", HERE / "kill_tree.mjs", pid], timeout=60)
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
    return out


def summary(res: dict) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    text = f"## Spike 5.1 probe: {OS}\n\n```json\n{json.dumps(res, indent=1)[:60000]}\n```\n"
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(text)


def main() -> int:
    phase = sys.argv[1]
    res = load()
    if phase == "pre":
        step(res, "host", host_info)
        step(res, "install", install_bmad_loop)
        step(res, "sandboxes", sandboxes)
        step(res, "worktree_paths", worktree_paths)
        step(res, "scaffold", scaffold_project)
        step(res, "v7_and_validate", v7_and_validate)
        step(res, "no_mux_run", no_mux_run)
    else:
        res["mux_after_install"] = run([bl_exe(), "mux"], env=bl_env())
        step(res, "happy_run", happy_run)
        step(res, "stop_kill_tree", lambda: stop_probe("kill"))
        step(res, "stop_bmad_loop", lambda: stop_probe("stop"))
        summary(res)
    save(res)
    return 0


if __name__ == "__main__":
    sys.exit(main())
