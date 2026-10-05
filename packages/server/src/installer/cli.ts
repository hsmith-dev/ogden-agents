/**
 * `ogden-install`: installs and starts Ogden Agents from GitHub Releases
 * (story 3). The start scripts run it (`--github` or
 * `OGDEN_AGENTS_SOURCE=github`); it is bundled to one file and shipped as a
 * release asset, never downloaded by the scripts.
 *
 *   ogden-install start [launcher options]   update when a newer release exists, then start
 *   ogden-install update                     install the newest release (even one skipped by rollback), don't start
 *   ogden-install rollback                   go back to the previous installed version
 *   ogden-install status                     what is installed and where from; no network
 *
 * Environment: OGDEN_AGENTS_REPO (default hsmith-dev/ogden-agents),
 * OGDEN_AGENTS_CHANNEL (stable or next; default follows the installed
 * version), OGDEN_AGENTS_APP_DIR, and a GitHub token for private repositories
 * from OGDEN_AGENTS_GITHUB_TOKEN, GITHUB_TOKEN or `gh auth token`. The token
 * is sent only to api.github.com, never stored, never printed.
 */
import {
  channelFor,
  createGitHubReleasesSource,
  DEFAULT_API_BASE,
  DEFAULT_REPO,
  isNewer,
  isRepoName,
  maskSecrets,
  ReleaseSourceError,
  type Channel,
  type ReleaseInfo,
  type VersionSource,
} from '@ogden-agents/shared/release-source';
import { DownloadError } from './download.js';
import { InstallError, installRelease, rollback, type InstallDeps } from './install.js';
import { defaultAppDir, launcherPath, readState } from './state.js';

export interface CliDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  platform: string;
  home: string;
  out(line: string): void;
  err(line: string): void;
  /** `gh auth token`'s output, or undefined when gh is missing or signed out. */
  ghToken(): Promise<string | undefined>;
  npmInstall(prefix: string, tarball: string): Promise<void>;
  /** Runs the installed launcher with Node and `args`, resolving with its exit code. */
  startLauncher(launcher: string, args: string[]): Promise<number>;
  extraAllowedHosts?: readonly string[];
}

const PRIVATE_HELP = [
  'If this repository is private, GitHub answers 404 (not "private") to anyone it does not know, and release files need a sign-in:',
  '  - with the GitHub CLI: run  gh auth login  once, then start again, or',
  '  - set OGDEN_AGENTS_GITHUB_TOKEN (or GITHUB_TOKEN) to a token that can read the repository\'s contents.',
  'The token is used only to ask GitHub, is never saved by Ogden Agents, and is never printed. To use another repository, set OGDEN_AGENTS_REPO=owner/name.',
];

function parseChannel(value: string | undefined): Channel | undefined | 'invalid' {
  if (value === undefined || value === '') return undefined;
  return value === 'stable' || value === 'next' ? value : 'invalid';
}

export async function run(argv: readonly string[], deps: CliDeps): Promise<number> {
  const [command = 'start', ...rest] = argv;
  // The start scripts' own flags are theirs, not the launcher's.
  const launcherArgs = rest.filter((arg) => arg !== '--github' && arg !== '--check');
  const env = deps.env;
  const appDir = defaultAppDir(env, deps.platform, deps.home);
  const repo = env.OGDEN_AGENTS_REPO !== undefined && env.OGDEN_AGENTS_REPO !== '' ? env.OGDEN_AGENTS_REPO : DEFAULT_REPO;
  if (!isRepoName(repo)) {
    deps.err(`OGDEN_AGENTS_REPO is "${repo}", which is not a repository name like owner/name.`);
    return 2;
  }
  const channelEnv = parseChannel(env.OGDEN_AGENTS_CHANNEL);
  if (channelEnv === 'invalid') {
    deps.err(`OGDEN_AGENTS_CHANNEL must be "stable" or "next", not "${env.OGDEN_AGENTS_CHANNEL}".`);
    return 2;
  }
  const apiBase = env.OGDEN_AGENTS_GITHUB_API !== undefined && env.OGDEN_AGENTS_GITHUB_API !== '' ? env.OGDEN_AGENTS_GITHUB_API : DEFAULT_API_BASE;

  // The API address is GitHub's unless a test (or GitHub Enterprise) says otherwise; the token goes to it, so it must be https, or this computer's own loopback.
  if (!/^https:\/\/[^/]+/i.test(apiBase) && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(apiBase)) {
    deps.err('OGDEN_AGENTS_GITHUB_API must be an https address.');
    return 2;
  }

  const state = readState(appDir);

  if (command === 'status') {
    deps.out(`Source: GitHub Releases of ${repo}`);
    deps.out(`App folder: ${appDir}`);
    deps.out(`Installed: ${state.current ?? 'nothing yet'}${state.previous === undefined ? '' : ` (previous ${state.previous}, kept for rollback)`}`);
    deps.out(`Channel: ${channelEnv ?? (state.current === undefined ? 'stable' : channelFor(state.current))}`);
    return 0;
  }

  if (command === 'rollback') {
    const result = rollback(appDir);
    if (result === undefined) {
      deps.err('There is no previous version to go back to.');
      return 1;
    }
    deps.out(`Rolled back from ${result.from} to ${result.now}. Starting will not install ${result.from} again; "update" does.`);
    return 0;
  }

  if (command !== 'start' && command !== 'update') {
    deps.err(`Unknown command "${command}". Use start, update, rollback or status.`);
    return 2;
  }

  // A token from the environment is used from the start; with none, ask unauthenticated first (a public repository needs none) and look for `gh` only if GitHub says it can't find the repository.
  let token = [env.OGDEN_AGENTS_GITHUB_TOKEN, env.GITHUB_TOKEN].find((t) => t !== undefined && t !== '');
  const mask = (text: string): string => maskSecrets(text, [token]);
  const channel: Channel = channelEnv ?? (state.current === undefined ? 'stable' : channelFor(state.current));
  const apiOrigin = new URL(apiBase).origin;

  const source = (): VersionSource => createGitHubReleasesSource({ repo, apiBase, token, fetch: (url, init) => deps.fetch(url, init) });
  const installDeps = (): InstallDeps => ({
    download: { fetch: deps.fetch, token, apiOrigin, ...(deps.extraAllowedHosts === undefined ? {} : { extraAllowedHosts: deps.extraAllowedHosts }) },
    npmInstall: deps.npmInstall,
    log: (line) => deps.out(mask(line)),
  });

  const startInstalled = async (): Promise<number> => {
    const current = readState(appDir).current;
    if (current === undefined) {
      deps.err('Ogden Agents is not installed yet.');
      return 1;
    }
    deps.out(`Starting Ogden Agents ${current}.`);
    return deps.startLauncher(launcherPath(appDir, current), command === 'start' ? launcherArgs : []);
  };

  let latest: ReleaseInfo | undefined;
  try {
    deps.out(`Looking for the newest ${channel === 'stable' ? 'stable ' : ''}release of ${repo} on GitHub...`);
    try {
      latest = await source().latest(channel);
    } catch (error) {
      if (token === undefined && error instanceof ReleaseSourceError && (error.kind === 'not-found' || error.kind === 'unauthorized')) {
        token = await deps.ghToken();
        if (token === undefined) throw error;
        deps.out('GitHub could not find it without signing in; using your GitHub CLI sign-in.');
        latest = await source().latest(channel);
      } else {
        throw error;
      }
    }
  } catch (error) {
    const message = mask(error instanceof Error ? error.message : String(error));
    if (state.current !== undefined && command === 'start') {
      deps.err(`Could not check for updates (${message}). Starting the installed version instead.`);
      return startInstalled();
    }
    deps.err(`Could not look up the release: ${message}`);
    if (error instanceof ReleaseSourceError && (error.kind === 'not-found' || error.kind === 'unauthorized')) {
      deps.err(error.hadToken ? 'GitHub refused the token or could not find the repository with it. Check the token can read the repository (and that the repository name is right).' : '');
      for (const line of PRIVATE_HELP) deps.err(line);
      if (channel === 'stable') deps.err('If the repository has only prereleases (for example 0.4.0-rc.1), there is no stable release yet: set OGDEN_AGENTS_CHANNEL=next.');
    } else if (error instanceof ReleaseSourceError && error.kind === 'rate-limited') {
      deps.err('GitHub limits requests without a sign-in. Wait a while, or provide a token as described above.');
    } else if (error instanceof ReleaseSourceError && error.kind === 'network') {
      deps.err('Check your internet connection and try again.');
    }
    return 1;
  }

  if (latest === undefined) {
    if (state.current !== undefined && command === 'start') return startInstalled();
    deps.err(`${repo} has no ${channel === 'stable' ? 'stable ' : ''}release yet.`);
    return 1;
  }

  const have = state.current;
  const wanted = have === undefined || (isNewer(have, latest.version) && (command === 'update' || latest.version !== state.skip));
  if (wanted) {
    deps.out(have === undefined ? `Installing Ogden Agents ${latest.version}.` : `Updating Ogden Agents from ${have} to ${latest.version}.`);
    try {
      await installRelease(appDir, latest, installDeps());
    } catch (error) {
      const message = mask(error instanceof Error ? error.message : String(error));
      deps.err(`The install did not finish: ${message}`);
      if (error instanceof DownloadError && (error.kind === 'not-found' || error.kind === 'unauthorized')) for (const line of PRIVATE_HELP) deps.err(line);
      if (!(error instanceof InstallError) && !(error instanceof DownloadError)) deps.err('The messages above say why. Nothing was changed: the version you had is untouched.');
      if (readState(appDir).current !== undefined && command === 'start') {
        deps.err('Starting the version already installed instead.');
        return startInstalled();
      }
      return 1;
    }
  } else if (have !== undefined) {
    deps.out(`Ogden Agents ${have} is the newest${latest.version === state.skip ? ' that you have not rolled back from' : ''} (latest release: ${latest.version}).`);
  }
  if (command === 'update') return 0;
  return startInstalled();
}
