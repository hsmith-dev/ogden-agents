/**
 * What an agent is, as data (epic 6 contract, 6.3; AD-1): every agent Ogden
 * Agents can chat with is described by one `AgentDescriptor`, which its
 * adapter exports and server wiring registers beside its `AgentPort` (and
 * `AgentSetupPort`). Core reads only these fields and names no agent; the
 * shape fits every agent the spikes probed (6.1, 12.1, 12.2) without a
 * branch on an id.
 */
import { AgentId as AgentIdSchema, PERMISSION_MODES, type AgentAuthMethodKind, type AgentId, type PermissionMode } from '@ogden-agents/shared';

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
   * The permission modes it declares, each with its own name for that mode
   * (a mode id, or the flag it takes). Ask is every agent's. It must list
   * exactly the modes its `AgentPort.permissionModes` declares.
   */
  permissionModes: Readonly<{ ask: string } & Partial<Record<Exclude<PermissionMode, 'ask'>, string>>>;
  /**
   * The agent runs the project's own agent settings or hooks, so a chat with
   * it starts only in a project the user trusted.
   */
  needsProjectTrust: boolean;
  /** Where in a project its skills go (repo-relative, `/`-separated), for BMad setup. */
  skillsFolder: string;
  /**
   * How a message sent right away reaches it while it works (send now or
   * wait): `inject` puts it into the running turn (the agent must also
   * advertise it when it starts, else `interrupt` is used); `interrupt`
   * stops the current step and sends it at once. Absent: `interrupt`.
   */
  sendNow?: SendNowStyle | undefined;
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
  const modes = Object.entries(descriptor.permissionModes);
  for (const [mode, nativeId] of modes) {
    if (!(PERMISSION_MODES as readonly string[]).includes(mode)) at(`${mode} is not a permission mode`);
    if (typeof nativeId !== 'string' || nativeId.trim() === '') at(`the ${mode} mode has no native id`);
  }
  if (typeof descriptor.permissionModes.ask !== 'string') at('the agent does not declare Ask');
  if (descriptor.sendNow !== undefined && !(SEND_NOW_STYLES as readonly string[]).includes(descriptor.sendNow)) at(`${String(descriptor.sendNow)} is not a send now style`);
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
