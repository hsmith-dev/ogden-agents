"""Spike 5.1 (temporary): a fake coding CLI for bmad-loop's generic adapter.

Modelled on bmad-loop's own tests/test_stories_e2e.py FAKE_CLI, in Python so the
same script runs on macOS, Linux and Windows. No LLM, no account, no network.

argv: fake_agent.py --mode done|hang --marker <dir> <prompt...>

- done: writes the id-keyed story spec with status done and a code change, then
  the SessionStart and Stop hook events, then idles until the engine kills it.
- hang: writes SessionStart, starts a child process (so there is a tree), and
  never stops.

Every invocation records its pid, parent pid, env and argv to <marker>.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path


def event(ed: Path, name: str, tid: str) -> None:
    ts = time.time_ns()
    ed.mkdir(parents=True, exist_ok=True)
    payload = {"ts": ts, "event": name, "task_id": tid, "session_id": "fake-1"}
    tmp = ed / f".{ts}-{tid}-{name}.tmp"
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    os.replace(tmp, ed / f"{ts}-{tid}-{name}.json")


def main() -> int:
    args = sys.argv[1:]
    mode = args[args.index("--mode") + 1]
    marker = Path(args[args.index("--marker") + 1])
    prompt = " ".join(a for i, a in enumerate(args) if i > 3)
    marker.mkdir(parents=True, exist_ok=True)
    env = {k: v for k, v in os.environ.items() if k.startswith("BMAD_LOOP_")}
    rd = Path(env.get("BMAD_LOOP_RUN_DIR", "."))
    tid = env.get("BMAD_LOOP_TASK_ID", "task")
    story = env.get("BMAD_LOOP_STORY_KEY", "")
    folder = env.get("BMAD_LOOP_SPEC_FOLDER", "")
    ed = Path(env.get("BMAD_LOOP_EVENTS_DIR") or rd / "events")
    child = None
    if mode == "hang":
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(3600)"])
    (marker / f"agent-{tid}.json").write_text(
        json.dumps(
            {
                "pid": os.getpid(),
                "ppid": os.getppid(),
                "child_pid": child.pid if child else None,
                "cwd": os.getcwd(),
                "mode": mode,
                "prompt": prompt,
                "env": env,
                "path_env": os.environ.get("PATH", ""),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    event(ed, "SessionStart", tid)
    if mode == "hang":
        while True:
            time.sleep(1)
    baseline = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    with open("src.txt", "a", encoding="utf-8") as f:
        f.write(f"impl for {story}\n")
    if folder:
        sdir = Path(folder) / "stories"
        sdir.mkdir(parents=True, exist_ok=True)
        spec = sdir / f"{story}-probe.md"
    else:
        sdir = Path("_bmad-output/implementation-artifacts")
        sdir.mkdir(parents=True, exist_ok=True)
        spec = sdir / f"spec-{story}.md"
    spec.write_text(
        f"---\ntitle: {story}\nstatus: done\nbaseline_commit: {baseline}\n---\n\n"
        f"# {story}\n\n## Auto Run Result\n\n- Status: done\n\nSummary: fake agent.\n",
        encoding="utf-8",
    )
    event(ed, "Stop", tid)
    time.sleep(60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
