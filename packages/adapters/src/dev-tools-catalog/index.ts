/**
 * Generic developer CLI tools (CAP-25, story: generic developer CLI tools
 * detect, install, and sandbox-gate): Ogden's own small seed catalog (real
 * tools, with each vendor's own documented non-interactive install command
 * for this OS, preferring a user-writable destination over one needing
 * `sudo`/admin where the vendor documents one) and the `DevToolsPort`
 * adapter. Core names no tool (AD-1): this is the one place that does.
 *
 * Detection never runs the program (only a filesystem look, like
 * `pane-launchers/detect.ts`'s bare-name-on-PATH and `~`/`%VAR%`
 * known-location convention, written fresh here so this feature stays its
 * own thing, not a dependency on epic 16's terminal panes). Running the
 * real install command is the one place this adapter spawns a child
 * process, always with an explicit allowlisted environment, never
 * `process.env` (AD-16; `tests/architecture.test.ts`).
 */
import { exec } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import type { DevToolDescriptor, DevToolDetection, DevToolRunResult, DevToolsPort } from '@ogden-agents/core';
import { helperEnvironment } from '../child-env.js';

/** What this adapter needs of the computer; replaced in tests. */
export interface DevToolsSystem {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  /** Whether `path` exists and is a file the user can run. Never runs it. */
  runnable(path: string): boolean;
  /** Runs `command` as the shell would, with an explicit `env`; `undefined` output on a start failure. */
  exec(command: string, env: Record<string, string>, timeoutMs: number): Promise<{ code: number | null; stderrTail: string }>;
}

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
/** The most of stderr kept for a failure's plain reason (never shown raw, only its last line). */
const STDERR_TAIL_BYTES = 4 * 1024;

export const nodeDevToolsSystem: DevToolsSystem = {
  get platform() {
    return process.platform;
  },
  get env() {
    return process.env;
  },
  runnable(path) {
    try {
      if (!statSync(path).isFile()) return false;
      if (process.platform === 'win32') return true;
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  exec(command, env, timeoutMs) {
    return new Promise((resolve) => {
      const child = exec(command, { env, timeout: timeoutMs, killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 1024 * 1024 }, (error, _stdout, stderr) => {
        const tail = String(stderr).slice(-STDERR_TAIL_BYTES).trim();
        if (error === null) {
          resolve({ code: 0, stderrTail: tail });
          return;
        }
        const code = typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? ((error as unknown as { code: number }).code) : null;
        resolve({ code, stderrTail: tail !== '' ? tail : error.message });
      });
      child.stdin?.end();
    });
  },
};

const platformKey = (platform: NodeJS.Platform): 'darwin' | 'linux' | 'win32' => (platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux');

/** One candidate's expanded absolute paths: a bare name tried on every `PATH` folder (with `PATHEXT` on Windows), or one expanded absolute/known-location path. */
function candidatesFor(entry: string, system: DevToolsSystem): string[] {
  const win = system.platform === 'win32';
  const path = win ? win32 : posix;
  const env = system.env;
  const lookup = (name: string) => Object.entries(env).find(([key]) => (win ? key.toUpperCase() === name.toUpperCase() : key === name))?.[1];
  if (/^[A-Za-z0-9._-]+$/.test(entry)) {
    const dirs = (lookup('PATH') ?? '').split(win ? ';' : ':').filter((dir) => dir !== '' && (win ? /^[A-Za-z]:[\\/]/.test(dir) : path.isAbsolute(dir)));
    const exts = win ? (lookup('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((ext) => ext.toLowerCase()) : [''];
    return dirs.flatMap((dir) => exts.map((ext) => path.join(dir, `${entry}${ext}`)));
  }
  const home = win ? (lookup('USERPROFILE') ?? lookup('HOME')) : lookup('HOME');
  let missing = false;
  const withHome = entry.startsWith('~') ? (home === undefined || home === '' ? ((missing = true), entry) : home + entry.slice(1)) : entry;
  const expanded = withHome.replace(/%([\w()]+)%/g, (_, name: string) => {
    const value = lookup(name);
    if (value === undefined || value === '') missing = true;
    return value ?? '';
  });
  return !missing && path.isAbsolute(expanded) && !expanded.includes('%') ? [expanded] : [];
}

/** Looks for `tool` on PATH, then at its declared known locations. Never execs it. */
export async function detectDevTool(tool: DevToolDescriptor, system: DevToolsSystem = nodeDevToolsSystem): Promise<DevToolDetection> {
  for (const entry of tool.executables) {
    for (const candidate of candidatesFor(entry, system)) {
      if (system.runnable(candidate)) return { installed: true, path: candidate };
    }
  }
  return { installed: false };
}

/** Runs `tool.installCommand` for real, with an explicit allowlisted environment, never the server's own. */
export async function runDevTool(tool: DevToolDescriptor, system: DevToolsSystem = nodeDevToolsSystem): Promise<DevToolRunResult> {
  if (tool.installCommand === undefined) return { ok: false, reason: 'There is no known install command for this computer.' };
  const env = helperEnvironment([], system.env, system.platform);
  const { code, stderrTail } = await system.exec(tool.installCommand, env, INSTALL_TIMEOUT_MS);
  if (code === 0) return { ok: true };
  return { ok: false, reason: stderrTail !== '' ? stderrTail.split(/\r?\n/).pop()!.trim() || 'The install command failed.' : 'The install command failed.' };
}

/**
 * Ogden's own small seed list (gcloud, docker, kubectl, aws). A small
 * starting point, not a maintained per-tool catalog (CAP-25): the user can
 * name any further tool from Settings, which core stores and treats the
 * same way. Each `installCommand` is that vendor's own documented
 * non-interactive install, resolved for this process's OS.
 */
export function seedDevTools(platform: NodeJS.Platform = process.platform): DevToolDescriptor[] {
  const key = platformKey(platform);
  const pick = <T>(map: Record<'darwin' | 'linux' | 'win32', T | undefined>): T | undefined => map[key];
  const tools: Array<{ id: string; label: string; executables: Record<'darwin' | 'linux' | 'win32', string[]>; installCommand: Record<'darwin' | 'linux' | 'win32', string | undefined> }> = [
    {
      id: 'gcloud',
      label: 'Google Cloud CLI',
      executables: {
        darwin: ['gcloud', '~/google-cloud-sdk/bin/gcloud'],
        linux: ['gcloud', '~/google-cloud-sdk/bin/gcloud'],
        win32: ['gcloud', '%LOCALAPPDATA%\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd'],
      },
      installCommand: {
        // Google's own documented quick install (cloud.google.com/sdk/docs/install-sdk), with prompts disabled.
        darwin: 'curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts',
        linux: 'curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts',
        // The Windows installer is NSIS-based; Google documents these silent flags for an unattended run.
        win32:
          'powershell -NoProfile -NonInteractive -Command "$i=\\"$env:TEMP\\GoogleCloudSDKInstaller.exe\\"; (New-Object Net.WebClient).DownloadFile(\'https://dl.google.com/dl/cloudsdk/channels/rapid/GoogleCloudSDKInstaller.exe\', $i); Start-Process -FilePath $i -ArgumentList \'/S\',\'/allusers=0\',\'/noreporting\',\'/nodesktop\' -Wait"',
      },
    },
    {
      id: 'docker',
      label: 'Docker',
      executables: {
        darwin: ['docker', '/usr/local/bin/docker', '/opt/homebrew/bin/docker'],
        linux: ['docker', '/usr/bin/docker'],
        win32: ['docker', '%ProgramFiles%\\Docker\\Docker\\resources\\bin\\docker.exe'],
      },
      installCommand: {
        // Docker Desktop has no non-interactive installer of its own on macOS; Homebrew's cask is Docker's own documented route.
        darwin: 'brew install --cask docker',
        // Docker's own documented convenience script (get.docker.com).
        linux: 'curl -fsSL https://get.docker.com | sh',
        // winget is Windows' own package manager; Docker's docs list it as a supported install path.
        win32: 'winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements',
      },
    },
    {
      id: 'kubectl',
      label: 'kubectl',
      executables: {
        darwin: ['kubectl', '~/.local/bin/kubectl'],
        linux: ['kubectl', '~/.local/bin/kubectl'],
        win32: ['kubectl', '%LOCALAPPDATA%\\Microsoft\\WinGet\\Links\\kubectl.exe'],
      },
      installCommand: {
        // kubernetes.io's own curl install, to a user-writable folder (no sudo) rather than its sudo-to-/usr/local/bin variant.
        darwin:
          'mkdir -p "$HOME/.local/bin" && curl -L "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/darwin/$(test "$(uname -m)" = arm64 && echo arm64 || echo amd64)/kubectl" -o "$HOME/.local/bin/kubectl" && chmod +x "$HOME/.local/bin/kubectl"',
        linux:
          'mkdir -p "$HOME/.local/bin" && curl -L "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" -o "$HOME/.local/bin/kubectl" && chmod +x "$HOME/.local/bin/kubectl"',
        // kubernetes.io documents winget as a Windows install path.
        win32: 'winget install -e --id Kubernetes.kubectl --accept-source-agreements --accept-package-agreements',
      },
    },
    {
      id: 'aws',
      label: 'AWS CLI',
      executables: {
        darwin: ['aws', '/usr/local/bin/aws'],
        linux: ['aws', '~/.local/bin/aws'],
        win32: ['aws', '%ProgramFiles%\\Amazon\\AWSCLIV2\\aws.exe'],
      },
      installCommand: {
        // AWS's own documented macOS pkg installer.
        darwin: 'curl -sS "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "$TMPDIR/AWSCLIV2.pkg" && sudo installer -pkg "$TMPDIR/AWSCLIV2.pkg" -target /',
        // AWS's own documented bundled installer, with its `-i`/`-b` flags for a per-user install (no sudo).
        linux:
          'cd "$(mktemp -d)" && curl -sS "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip && unzip -q awscliv2.zip && ./aws/install -i "$HOME/.local/aws-cli" -b "$HOME/.local/bin"',
        // AWS's own documented silent msiexec install.
        win32: 'msiexec /i https://awscli.amazonaws.com/AWSCLIV2.msi /qn',
      },
    },
  ];
  return tools.map((tool) => ({ id: tool.id, label: tool.label, source: 'seed' as const, executables: tool.executables[key], installCommand: pick(tool.installCommand) }));
}

export function createDevToolsAdapter(system: DevToolsSystem = nodeDevToolsSystem): DevToolsPort {
  return {
    seedCatalog: () => seedDevTools(system.platform),
    detect: (tool) => detectDevTool(tool, system),
    run: (tool) => runDevTool(tool, system),
  };
}
