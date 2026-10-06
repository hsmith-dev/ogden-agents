/**
 * What an agent is, as data (epic 6 contract, 6.3; AD-1): every agent Ogden
 * Agents can chat with is described by one `AgentDescriptor`, which its
 * adapter exports and server wiring registers beside its `AgentPort` (and
 * `AgentSetupPort`). Core reads only these fields and names no agent; the
 * shape fits every agent the spikes probed (6.1, 12.1, 12.2) without a
 * branch on an id.
 */
import { AgentId as AgentIdSchema, AgentModel as AgentModelSchema, MAX_HANDOFF_BRIEF_CHARS, PERMISSION_MODES, type AgentAuthMethodKind, type AgentId, type AgentModel, type PermissionMode } from '@ogden-agents/shared';

/** An OS and CPU an agent's pinned install is for, as Node names them (`process.platform`-`process.arch`). */
export const AGENT_PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64'] as const;
export type AgentPlatform = (typeof AGENT_PLATFORMS)[number];

/**
 * Where an agent's pinned copy comes from (AD-21: installed into the data
 * folder, never globally; a version is bumped only by a reviewed change).
 *
 * - `npm`: an exact package version, installed with its pinned lockfile
 *   (each tarball's integrity is in the lock). `binarySha256` pins, per
 *   platform, a binary the package unpacks that Ogden checks itself.
 * - `archive`: one download per platform, checked against Ogden's own
 *   SHA-256 (the vendor publishes none).
 */
export type AgentInstallSource =
  | { kind: 'npm'; package: string; version: string; binarySha256?: Readonly<Partial<Record<AgentPlatform, string>>> | undefined }
  | { kind: 'archive'; version: string; archives: Readonly<Partial<Record<AgentPlatform, { url: string; sha256: string }>>> };

/**
 * An API key an agent can run on (AD-16). `envNames[0]` is the variable
 * Ogden sets in the agent's own chat process; every name (the agent may read
 * several) is kept out of every other process. `format` is plain words on
 * what a key looks like, for the UI; never a key.
 */
export interface AgentApiKeyDescriptor {
  envNames: readonly [string, ...string[]];
  format?: string | undefined;
  /** What the key is called in the UI's words when it is not "API key" (Grok: "xAI API access token"). */
  label?: string | undefined;
}

/**
 * One way the agent signs in. `id` is the agent's own method id (what its
 * `authenticate` takes), `kind` how the UI groups it, `label` its words.
 * An `api_key` method says how the key reaches the agent.
 */
export interface AgentSignInMethodDescriptor {
  id: string;
  kind: AgentAuthMethodKind;
  label: string;
  apiKey?: AgentApiKeyDescriptor | undefined;
}

export interface AgentDescriptor {
  /** The agent's stable kebab-case id. */
  agentId: AgentId;
  /** Its product name, as the UI names it. */
  displayName: string;
  /** Who makes it, for the agent card. */
  provider: string;
  install: AgentInstallSource;
  /**
   * The variable that moves the agent's own settings, sessions and logs into
   * a folder Ogden gives it in the data folder (`<dataDir>/agents/<id>-home`),
   * so nothing lands in the user's real profile; absent when the agent uses
   * the user's own (as Claude Code does).
   */
  homeEnv?: string | undefined;
  signInMethods: readonly AgentSignInMethodDescriptor[];
  /**
   * The agent needs no account and no key of its own (epic 14: a model served
   * on the user's own computer or endpoint): the card shows its endpoint's
   * state instead of a sign in, and a chat is never refused for a missing
   * sign in. Only with no sign in methods.
   */
  noAccount?: boolean | undefined;
  /**
   * The agent's vendor allows only a person at the keyboard to drive it
   * (epic 15): one plain sentence saying so, with no dash. Such an agent is
   * never a worker or reviewer a manager addresses. No agent Ogden ships today
   * sets it; an agent whose terms forbid automation must.
   */
  interactiveOnly?: string | undefined;
  /**
   * The permission modes it declares, each with its own name for that mode
   * (a mode id, or the flag it takes). Ask is every agent's. It must list
   * exactly the modes its `AgentPort.permissionModes` declares.
   */
  permissionModes: Readonly<{ ask: string } & Partial<Record<Exclude<PermissionMode, 'ask'>, string>>>;
  /**
   * One plain sentence appended to "<agent> doesn't offer <mode>." when a mode it doesn't declare is asked for
   * (epic 14: why a small local model is Ask only), so the picker says why, not only that.
   */
  modesNote?: string | undefined;
  /**
   * The agent runs the project's own agent settings or hooks, so a chat with
   * it starts only in a project the user trusted.
   */
  needsProjectTrust: boolean;
  /**
   * The repo-relative files and folders (`/`-separated) it runs from the
   * project when `needsProjectTrust` (its settings, hooks, MCP servers). The
   * user's trust of the project is bound to their contents, so a change asks
   * again before the agent's next start (epic 12, 12.3). Only with
   * `needsProjectTrust`.
   */
  projectFiles?: readonly string[] | undefined;
  /**
   * Its permission mode is given once, when a chat starts, and can't be
   * changed after (the agent has no way to switch it): core refuses a change
   * for a chat that has started, and the adapter gives the chat's mode at
   * every start, reopen and load (epic 12, 12.3).
   */
  modeFixedAtStart?: boolean | undefined;
  /**
   * Names of the agent's own config folders (a single folder name each, at any
   * depth) that join the protected paths, so an agent edit there is always a
   * card in Ask and Auto and Auto's guards cover them (epic 12, 12.3).
   */
  configFolders?: readonly string[] | undefined;
  /** Where in a project its skills go (repo-relative, `/`-separated), for BMad setup. */
  skillsFolder: string;
  /**
   * How the agent says it ran out of usage (a rate limit, a quota, a plan's
   * limit): patterns tested against its own error text when a prompt fails
   * (handoff, user decision 2026-10-04). A match makes the failure
   * `usage_limit`, and the chat offers to continue with another agent. Kept
   * narrow: a miss is an ordinary error. No `g` or `y` flag (they keep state).
   */
  usageLimitPatterns?: readonly RegExp[] | undefined;
  /**
   * The most characters of a handoff brief this agent is sent, from what its
   * context holds (default {@link DEFAULT_HANDOFF_BUDGET_CHARS}, at most
   * `MAX_HANDOFF_BRIEF_CHARS`).
   */
  handoffBudgetChars?: number | undefined;
  /**
   * For an agent whose sessions don't list their models over ACP (story 11):
   * the models it offers, and how its process is told one at start, a
   * variable or a command-line flag. Switching a chat's model then restarts
   * its agent (resumed) at the next idle point. Absent: the agent lists its
   * models itself (ACP session config option of category `model`), or offers none.
   */
  models?: AgentStaticModels | undefined;
  /**
   * How a message sent right away reaches it while it works (send now or
   * wait): `inject` puts it into the running turn (the agent must also
   * advertise it when it starts, else `interrupt` is used); `interrupt`
   * stops the current step and sends it at once. Absent: `interrupt`.
   */
  sendNow?: SendNowStyle | undefined;
}

/** A static model list and how a process is started on one of them (story 11). */
export interface AgentStaticModels {
  list: readonly AgentModel[];
  apply: { kind: 'env'; name: string } | { kind: 'arg'; flag: string };
}

/** A handoff brief's budget for an agent that names none. */
export const DEFAULT_HANDOFF_BUDGET_CHARS = 60_000;

/** The handoff brief budget of `descriptor`: its own, within the hard cap, else the default. */
export function handoffBudget(descriptor: Pick<AgentDescriptor, 'handoffBudgetChars'>): number {
  const own = descriptor.handoffBudgetChars;
  return own === undefined ? DEFAULT_HANDOFF_BUDGET_CHARS : Math.min(MAX_HANDOFF_BRIEF_CHARS, own);
}

/** Whether `text` (an agent's own error text) says, by `descriptor`'s patterns, that it ran out of usage. */
export function isUsageLimit(descriptor: Pick<AgentDescriptor, 'usageLimitPatterns'>, text: string): boolean {
  return text !== '' && (descriptor.usageLimitPatterns ?? []).some((pattern) => pattern.test(text));
}

/** How an agent takes a message sent right away while it works. */
export const SEND_NOW_STYLES = ['inject', 'interrupt'] as const;
export type SendNowStyle = (typeof SEND_NOW_STYLES)[number];

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** Whether `folder` is a plain repo-relative path: `/`-separated, no `.`, `..`, empty or absolute part. */
function isRelativeFolder(folder: string): boolean {
  if (folder === '' || folder.startsWith('/') || folder.includes('\\') || /^[A-Za-z]:/.test(folder)) return false;
  return folder.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** Every problem with `descriptor`, in plain words for a developer; `[]` when it is sound. */
export function agentDescriptorProblems(descriptor: AgentDescriptor): string[] {
  const problems: string[] = [];
  const at = (what: string) => problems.push(`${String(descriptor.agentId)}: ${what}`);
  if (!AgentIdSchema.safeParse(descriptor.agentId).success) at('the agent id is not kebab-case');
  if (descriptor.displayName.trim() === '') at('the product name is empty');
  if (descriptor.provider.trim() === '') at('the provider is empty');
  const { install } = descriptor;
  if (install.version.trim() === '') at('the pinned version is empty');
  if (install.kind === 'npm') {
    if (install.package.trim() === '') at('the npm package is empty');
    for (const [platform, sha256] of Object.entries(install.binarySha256 ?? {})) {
      if (!(AGENT_PLATFORMS as readonly string[]).includes(platform)) at(`${platform} is not a platform`);
      if (!SHA256.test(sha256 ?? '')) at(`the ${platform} binary's SHA-256 is not 64 lower-case hex digits`);
    }
  } else {
    const archives = Object.entries(install.archives);
    if (archives.length === 0) at('the install has no archive');
    for (const [platform, archive] of archives) {
      if (!(AGENT_PLATFORMS as readonly string[]).includes(platform)) at(`${platform} is not a platform`);
      if (archive === undefined) continue;
      if (!archive.url.startsWith('https://')) at(`the ${platform} archive is not an https URL`);
      if (!SHA256.test(archive.sha256)) at(`the ${platform} archive's SHA-256 is not 64 lower-case hex digits`);
    }
  }
  if (descriptor.homeEnv !== undefined && !ENV_NAME.test(descriptor.homeEnv)) at(`${descriptor.homeEnv} is not an environment variable name`);
  const methodIds = new Set<string>();
  for (const method of descriptor.signInMethods) {
    if (method.id.trim() === '' || method.label.trim() === '') at('a sign-in method has no id or label');
    if (methodIds.has(method.id)) at(`the sign-in method ${method.id} is listed twice`);
    methodIds.add(method.id);
    if (method.kind === 'api_key' && method.apiKey === undefined) at(`the API key method ${method.id} names no variable`);
    if (method.kind !== 'api_key' && method.apiKey !== undefined) at(`the method ${method.id} has a key but is not an API key method`);
    for (const name of method.apiKey?.envNames ?? []) if (!ENV_NAME.test(name)) at(`${name} is not an environment variable name`);
    if (descriptor.homeEnv !== undefined && method.apiKey?.envNames.includes(descriptor.homeEnv)) at(`${descriptor.homeEnv} is both the home and a key variable`);
  }
  if (descriptor.interactiveOnly !== undefined && (descriptor.interactiveOnly.trim() === '' || /[\u2013\u2014]/.test(descriptor.interactiveOnly))) at('the interactive only sentence is empty or has a dash');
  if (descriptor.noAccount === true && descriptor.signInMethods.length > 0) at('it needs no account but lists sign in methods');
  const modes = Object.entries(descriptor.permissionModes);
  for (const [mode, nativeId] of modes) {
    if (!(PERMISSION_MODES as readonly string[]).includes(mode)) at(`${mode} is not a permission mode`);
    if (typeof nativeId !== 'string' || nativeId.trim() === '') at(`the ${mode} mode has no native id`);
  }
  if (typeof descriptor.permissionModes.ask !== 'string') at('the agent does not declare Ask');
  for (const folder of descriptor.configFolders ?? []) {
    if (!isRelativeFolder(folder) || folder.includes('/')) at(`the config folder ${JSON.stringify(folder)} is not a single folder name`);
  }
  if (descriptor.projectFiles !== undefined) {
    if (!descriptor.needsProjectTrust) at('it lists project files but does not need project trust');
    for (const file of descriptor.projectFiles) if (!isRelativeFolder(file)) at(`the project file ${JSON.stringify(file)} is not a plain repo-relative path`);
  }
  if (descriptor.models !== undefined) {
    const { list, apply } = descriptor.models;
    if (list.length === 0) at('the static model list is empty');
    const ids = new Set<string>();
    for (const model of list) {
      if (!AgentModelSchema.safeParse(model).success) at(`${JSON.stringify(model.id)} is not a model`);
      if (ids.has(model.id)) at(`the model ${model.id} is listed twice`);
      ids.add(model.id);
    }
    if (apply.kind === 'env' && !ENV_NAME.test(apply.name)) at(`${apply.name} is not an environment variable name`);
    if (apply.kind === 'arg' && !/^--?[A-Za-z][A-Za-z0-9-]*$/.test(apply.flag)) at(`${apply.flag} is not a command-line flag`);
  }
  for (const pattern of descriptor.usageLimitPatterns ?? []) {
    if (!(pattern instanceof RegExp)) at('a usage-limit pattern is not a regular expression');
    else if (pattern.global || pattern.sticky) at(`the usage-limit pattern ${String(pattern)} has the g or y flag`);
  }
  const budget = descriptor.handoffBudgetChars;
  if (budget !== undefined && (!Number.isInteger(budget) || budget < 1_000 || budget > MAX_HANDOFF_BRIEF_CHARS)) {
    at(`the handoff budget ${String(budget)} is not a whole number from 1000 to ${MAX_HANDOFF_BRIEF_CHARS}`);
  }
  if (descriptor.sendNow !== undefined && !(SEND_NOW_STYLES as readonly string[]).includes(descriptor.sendNow)) at(`${String(descriptor.sendNow)} is not a send now style`);
  if (descriptor.modesNote !== undefined && (descriptor.modesNote.trim() === '' || /[\u2013\u2014]/.test(descriptor.modesNote))) at('the modes note is empty or has a dash');
  if (!isRelativeFolder(descriptor.skillsFolder)) at(`the skills folder ${JSON.stringify(descriptor.skillsFolder)} is not a plain repo-relative path`);
  return problems;
}

/** The permission modes `descriptor` declares, in Ogden's order. */
export function declaredModes(descriptor: AgentDescriptor): PermissionMode[] {
  return PERMISSION_MODES.filter((mode) => descriptor.permissionModes[mode] !== undefined);
}

/** The API key method of `descriptor`, if it has one. */
export function apiKeyMethod(descriptor: AgentDescriptor): (AgentSignInMethodDescriptor & { apiKey: AgentApiKeyDescriptor }) | undefined {
  return descriptor.signInMethods.find((method): method is AgentSignInMethodDescriptor & { apiKey: AgentApiKeyDescriptor } => method.apiKey !== undefined);
}

/**
 * Every API key variable of `descriptors`, each once (AD-16): the names kept
 * out of every agent process but their own agent's (`AGENT_ENV_KEYS`).
 */
export function agentEnvKeys(descriptors: readonly AgentDescriptor[]): string[] {
  const names = descriptors.flatMap((descriptor) => descriptor.signInMethods.flatMap((method) => method.apiKey?.envNames ?? []));
  return [...new Set(names)];
}

/** Every config folder name of `descriptors`, each once (they join the protected paths). */
export function agentConfigFolders(descriptors: readonly AgentDescriptor[]): string[] {
  return [...new Set(descriptors.flatMap((descriptor) => descriptor.configFolders ?? []))];
}

/** Every project file the agents that need project trust run, each once, sorted: what the trust is bound to. */
export function agentProjectFiles(descriptors: readonly AgentDescriptor[]): string[] {
  return [...new Set(descriptors.flatMap((descriptor) => (descriptor.needsProjectTrust ? (descriptor.projectFiles ?? []) : [])))].sort();
}
