/**
 * `sandbox-docker` (story 5.6): the chain's second step, Docker, "only when
 * it is already installed and running" (agent-matrix.md). It asks the
 * `docker` program what its server is (`docker version`, one call, a short
 * timeout, no shell, the caller's environment allowlist) and says what it
 * found in plain words: ready with Linux containers, in Windows containers
 * mode (which can't see a Linux worktree, spike 5.1), installed but not
 * running, or missing.
 *
 * This version of Ogden Agents cannot build inside Docker: which image
 * carries the agent, and how it reaches its model while its commands have no
 * network, are undecided (deferred-work.md), so even a ready Docker is
 * reported as `detected` and the step never offers a sandbox. A build is
 * never started in a container it cannot reach into.
 */
import { execFile } from 'node:child_process';
import type { SandboxProbe } from '@ogden-agents/shared';
import { DOCKER_HINT, type SandboxStep, type SandboxStepResult } from '../sandbox-chain/index.js';

/** What `docker version` says its server is. */
export type DockerState = 'ready' | 'windows_containers' | 'not_running' | 'missing';

export const DOCKER_MISSING_NOTE = "Docker isn't installed.";
export const DOCKER_NOT_RUNNING_NOTE = "Docker is installed, but it isn't running. Start Docker Desktop.";
export const DOCKER_WINDOWS_CONTAINERS_NOTE = 'Docker is running in Windows containers mode. Switch it to Linux containers.';
export const DOCKER_UNSUPPORTED_NOTE = "Docker is running here, but this version of Ogden Agents can't build inside it yet.";

export interface DockerStepOptions {
  /** Asks Docker what its server is. Default: runs `docker version`. */
  probe?: () => Promise<DockerState>;
  /** The environment of the `docker` child (an allowlist, never the server's own). */
  env?: () => Readonly<Record<string, string>>;
}

/** `docker version --format '{{.Server.Os}}'`, with a timeout; never throws. */
export function probeDocker(env: () => Readonly<Record<string, string>> = () => ({}), timeoutMs = 8000): Promise<DockerState> {
  return new Promise((resolve) => {
    execFile('docker', ['version', '--format', '{{.Server.Os}}'], { env: { ...env() }, timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
      if (error !== null) {
        resolve((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'not_running');
        return;
      }
      const os = stdout.trim().toLowerCase();
      resolve(os === 'linux' ? 'ready' : os === 'windows' ? 'windows_containers' : 'not_running');
    });
  });
}

export function createDockerStep(options: DockerStepOptions = {}): SandboxStep {
  const probe = options.probe ?? (() => probeDocker(options.env));
  return {
    async inspect(): Promise<SandboxStepResult> {
      let state: DockerState;
      try {
        state = await probe();
      } catch {
        state = 'not_running';
      }
      const found: SandboxProbe =
        state === 'ready'
          ? { kind: 'docker', state: 'detected', note: DOCKER_UNSUPPORTED_NOTE }
          : state === 'windows_containers'
            ? { kind: 'docker', state: 'blocked', note: DOCKER_WINDOWS_CONTAINERS_NOTE }
            : state === 'not_running'
              ? { kind: 'docker', state: 'blocked', note: DOCKER_NOT_RUNNING_NOTE }
              : { kind: 'docker', state: 'missing', note: DOCKER_MISSING_NOTE };
      // Never a sandbox here (see the header); the reason stays empty so the native step's explains why there is none.
      return { kind: undefined, probes: [found], reason: '', installHint: state === 'missing' ? DOCKER_HINT : null };
    },
  };
}
