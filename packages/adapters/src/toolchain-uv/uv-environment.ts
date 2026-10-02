/**
 * The one environment every `uv` process gets (story 4.1, moved here from the
 * server's `start-env.ts` by story 4.2 so the version probe and every script
 * run share it; AD-16, AD-22 note 2026-10-02): an allowlist of what a
 * process needs to run as the user (`PATH`, home, user, locale, terminal,
 * temp, shell, and on Windows what a process can't start without), plus
 * uv's own cache and data folders, and `PYTHONUTF8=1` so BMad Method's
 * scripts read and print UTF-8 on every OS.
 *
 * Nothing else of this server's environment passes: never an API key, a
 * token or another secret (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`), never an
 * `OGDEN_AGENTS_*` switch, never `NODE_OPTIONS` or `PYTHONPATH`. The
 * project's own BMad Method scripts run under it. Never logged.
 */

/** What a process needs to run as the user, on every OS (the agents' allowlist, without any agent key). */
const UV_ENV_ALLOWED = ['PATH', 'HOME', 'USERPROFILE', 'USER', 'USERNAME', 'LANG', 'TERM', 'TMPDIR', 'TEMP', 'TMP', 'SHELL'];
/** The same on Windows only, where a process can't start without them. */
const UV_ENV_ALLOWED_WINDOWS = ['SystemRoot', 'ComSpec', 'PATHEXT'];
/** Where uv keeps its cache and the Pythons it manages on each OS. */
const UV_FOLDERS_ALLOWED = ['XDG_CACHE_HOME', 'XDG_DATA_HOME', 'LOCALAPPDATA', 'APPDATA'];

/**
 * The environment of every `uv` child: {@link UV_ENV_ALLOWED} (and on
 * Windows its additions, names compared without case), `LC_ALL` and `LC_*`,
 * uv's folders, and `PYTHONUTF8=1`. Nothing else of `source`.
 */
export function uvEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  // Windows variable names are case-insensitive (`Path`, `SYSTEMROOT`).
  const fold = (name: string) => (platform === 'win32' ? name.toUpperCase() : name);
  const allowed = new Set([...UV_ENV_ALLOWED, ...(platform === 'win32' ? UV_ENV_ALLOWED_WINDOWS : []), ...UV_FOLDERS_ALLOWED].map(fold));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (allowed.has(fold(name)) || name === 'LC_ALL' || name.startsWith('LC_')) env[name] = value;
  }
  // Set last, under its own name only: a `pythonutf8` from `source` was never allowed in.
  env.PYTHONUTF8 = '1';
  return env;
}
