/**
 * `sandbox-chain` (story 5.6): core's `SandboxPort` as the chain the spec
 * and AD-17 describe, tried in order: the agent's native sandbox, then
 * Docker if it is already installed. Each step probes what works on this
 * computer and says why it doesn't; the chain takes the first one that can
 * hold an unattended build, and otherwise answers unavailable with the Build
 * dialog's choices and a plain explanation, never a guess. It runs nothing
 * of the project's and installs nothing: an install hint is only text.
 *
 * `check` and `status` are one inspection, so what the dialog says is what
 * the next Build does.
 */
import type { SandboxCheck, SandboxPort, SandboxRunRequest, SandboxRunResult } from '@ogden-agents/core';
import { DOCKER_INSTALL_URL, SANDBOX_LABELS, type SandboxChoice, type SandboxProbe, type SandboxStatus } from '@ogden-agents/shared';

/** What one step found. */
export interface SandboxStepResult {
  /** The sandbox kind (`seatbelt`, `bubblewrap`, `docker`) when this step can hold a build here now. */
  kind: string | undefined;
  /** What was probed, for the dialog. */
  probes: SandboxProbe[];
  /** Why this step can't (one plain sentence); empty when it can. */
  reason: string;
  /** What to install, as text; `null` when there is nothing to install. */
  installHint: string | null;
}

/** One sandbox in the chain. `inspect` never throws: a failed probe is "can't". */
export interface SandboxStep {
  inspect(): Promise<SandboxStepResult>;
  /** Runs one command in this step's sandbox (story 5.8); `undefined` when the request's sandbox kind is not this step's. */
  run?(request: SandboxRunRequest): Promise<SandboxRunResult | undefined>;
}

/** The Build dialog's choices without a sandbox: macOS and Linux (the entry's order), then Windows' with building with you watching first (user decision 2026-10-01). */
export const SANDBOX_CHOICES_DEFAULT: readonly SandboxChoice[] = ['other_agent', 'install_docker', 'attended'];
export const SANDBOX_CHOICES_WINDOWS: readonly SandboxChoice[] = ['attended', 'install_docker', 'other_agent'];

export const NO_SANDBOX_SUMMARY = "Claude Code can't build unattended on this computer yet.";
export const WINDOWS_HINT = 'Docker Desktop is optional on Windows. Building with you watching works without it.';
/** The `docs.docker.com` page, named in text so the hint is useful where a link isn't. */
export const DOCKER_HINT = `You can install Docker yourself from ${DOCKER_INSTALL_URL}. Ogden Agents never installs anything for you.`;

export interface SandboxChainOptions {
  platform?: NodeJS.Platform;
  /** The steps, in the order tried. */
  steps: readonly SandboxStep[];
  /** The sandbox label per kind, for the available summary. Default: `SANDBOX_LABELS`. */
  labels?: Readonly<Record<string, string>>;
}

function platformOf(platform: NodeJS.Platform): SandboxStatus['platform'] {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  if (platform === 'linux') return 'linux';
  return 'other';
}

/** The chain as a `SandboxPort`. */
export function createSandboxChain(options: SandboxChainOptions): SandboxPort {
  const platform = options.platform ?? process.platform;
  const choices = platform === 'win32' ? SANDBOX_CHOICES_WINDOWS : SANDBOX_CHOICES_DEFAULT;

  const inspect = async (): Promise<{ check: SandboxCheck; status: SandboxStatus }> => {
    const results: SandboxStepResult[] = [];
    for (const step of options.steps) {
      let result: SandboxStepResult;
      try {
        result = await step.inspect();
      } catch {
        // A step that fails is a step that can't (never a guess that it can).
        result = { kind: undefined, probes: [], reason: '', installHint: null };
      }
      results.push(result);
      if (result.kind !== undefined) {
        const label = (options.labels ?? (SANDBOX_LABELS as Readonly<Record<string, string>>))[result.kind] ?? result.kind;
        return {
          check: { available: true, kind: result.kind },
          status: { platform: platformOf(platform), available: true, kind: result.kind, summary: `Builds run inside ${label}.`, probes: results.flatMap((each) => each.probes), choices: [], installHint: null },
        };
      }
    }
    const reason = results.map((each) => each.reason).find((text) => text !== '') ?? NO_SANDBOX_SUMMARY;
    const hints = results.map((each) => each.installHint).filter((text): text is string => text !== null);
    const installHint = platform === 'win32' ? [WINDOWS_HINT, ...hints].join(' ') : hints.length === 0 ? null : hints.join(' ');
    return {
      check: { available: false, reason, choices },
      status: { platform: platformOf(platform), available: false, kind: null, summary: reason, probes: results.flatMap((each) => each.probes), choices: [...choices], installHint },
    };
  };

  return {
    async check() {
      return (await inspect()).check;
    },
    async status() {
      return (await inspect()).status;
    },
    async run(request) {
      for (const step of options.steps) {
        try {
          const result = await step.run?.(request);
          if (result !== undefined) return result;
        } catch {
          // A step that fails to run it did not run it: the next, or none.
        }
      }
      return undefined;
    },
  };
}
