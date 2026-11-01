/**
 * Where "Always allow" is never offered for a shell command (story 2.6,
 * user decision 2026-09-30, review F2; widened by the AD-40 security review,
 * epic 26 story 8): a first word that is an interpreter or a wrapper can run
 * anything, and so can a two-word wrapper (`npm exec`) or a command that sets
 * variables first. Core refuses the scope with it (and with its own shell
 * and path checks, `commandRuleRefusal`); the card writes the reason.
 */

/** Interpreters and wrappers that run whatever follows them. */
export const WRAPPER_COMMANDS: ReadonlySet<string> = new Set([
  'sudo',
  'doas',
  'env',
  'xargs',
  'nohup',
  'time',
  'nice',
  'exec',
  'eval',
  'command',
  'builtin',
  'bash',
  'sh',
  'zsh',
  'fish',
  'dash',
  'ksh',
  'pwsh',
  'powershell',
  'cmd',
  'python',
  'node',
  'deno',
  'bun',
  'npx',
  'bunx',
  'pnpx',
  'ruby',
  'perl',
  'php',
  'lua',
  'osascript',
  // AD-40 security review (epic 26 story 8): more programs that run whatever follows them.
  'timeout',
  'gtimeout',
  'stdbuf',
  'ionice',
  'chroot',
  'su',
  'runuser',
  'setsid',
  'caffeinate',
  'flock',
  'taskset',
  'watch',
  'strace',
  'ltrace',
  'dtruss',
  'script',
  'unbuffer',
  'parallel',
  'awk',
  'gawk',
  'mawk',
  'nawk',
  'busybox',
  'uvx',
  'pipx',
  'source',
  '.',
  'trap',
  'coproc',
  'start-stop-daemon',
  'systemd-run',
  'firejail',
  'unshare',
  'nsenter',
  'chrt',
  'cpulimit',
  'sandbox-exec',
  'arch',
  'open',
  'start',
  'wsl',
  'cscript',
  'wscript',
  'tclsh',
  'expect',
  'r',
  'rscript',
  'julia',
  'swift',
  'java',
  'jshell',
  // Independent review (2026-10-31): more shells, interpreters and wrappers.
  'tcsh',
  'csh',
  'ash',
  'mksh',
  'xonsh',
  'nu',
  'elvish',
  'xcrun',
  'nodejs',
  'pypy',
  'ipython',
  'irb',
  'ts-node',
  'tsx',
  'pkexec',
  'gdb',
  'lldb',
  'valgrind',
]);

/**
 * Two-word wrappers (AD-40 security review): a program whose subcommand runs
 * whatever follows it (`npm exec`, `pnpm dlx`, `uv run`, ...). The subcommand
 * is the first non-flag word; when a flag comes first it may take a value
 * (`npm --prefix dir exec x`), so then every later word is looked at and a
 * flag in between (`npm -y exec x`) does not hide it.
 */
export const TWO_WORD_WRAPPERS: Readonly<Record<string, ReadonlySet<string>>> = {
  // `create` and `init <x>` download and run a package's create script; `edit` opens an editor. npm takes
  // abbreviations of its commands (`npm exe` is `npm exec`), so those count too (independent review 2026-10-31).
  npm: new Set(['exec', 'x', 'e', 'ex', 'exe', 'explore', 'explo', 'explor', 'create', 'cr', 'cre', 'crea', 'creat', 'init', 'ini', 'innit', 'edit', 'ed', 'edi']),
  pnpm: new Set(['exec', 'dlx', 'create']),
  yarn: new Set(['exec', 'dlx', 'node', 'create']),
  uv: new Set(['run', 'tool']),
  poetry: new Set(['run']),
  pipenv: new Set(['run']),
  pdm: new Set(['run']),
  hatch: new Set(['run']),
  rye: new Set(['run']),
  conda: new Set(['run']),
  mamba: new Set(['run']),
  micromamba: new Set(['run']),
  bundle: new Set(['exec']),
  rbenv: new Set(['exec']),
  pyenv: new Set(['exec']),
  mise: new Set(['exec', 'x']),
  asdf: new Set(['exec']),
  direnv: new Set(['exec']),
  nix: new Set(['run', 'shell', 'develop']),
  'nix-shell': new Set(['--run', '--command']),
  devbox: new Set(['run']),
  // `docker container run` is `docker run`, and `create` then `start` runs one too (independent review 2026-10-31).
  docker: new Set(['run', 'exec', 'compose', 'container', 'create', 'start']),
  podman: new Set(['run', 'exec', 'compose', 'container', 'create', 'start']),
  nerdctl: new Set(['run', 'exec', 'compose', 'container', 'create', 'start']),
  'docker-compose': new Set(['run', 'exec']),
  'podman-compose': new Set(['run', 'exec']),
  kubectl: new Set(['exec', 'run', 'debug']),
  dotnet: new Set(['exec']),
  corepack: new Set(['npx', 'pnpx', 'yarn', 'pnpm', 'npm']),
  // `go run pkg@latest` downloads and runs a module.
  go: new Set(['run']),
};

/** A command's first word, as a program name: its last path segment, lowercased, without a Windows program extension. */
export const programName = (word: string): string =>
  (word.split(/[\\/]/).at(-1) ?? word).toLowerCase().replace(/\.(?:exe|cmd|bat|com|ps1)$/, '');

/**
 * Why Always allow isn't offered for `command`, in plain words for the
 * card, or `undefined` when nothing rules it out.
 */
export function alwaysAllowRefusal(command: string): string | undefined {
  // Quotes removed, so `"bash" -c x` names bash (core refuses a quoted first word outright).
  const first = command.trim().split(/[ \t]+/)[0]?.replace(/["']/g, '');
  if (first === undefined || first === '') return undefined;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
    return "Always allow isn't offered for a command that sets variables first, because they can change what it runs.";
  }
  const name = programName(first);
  if (WRAPPER_COMMANDS.has(name) || /^(?:python|pypy|ruby|perl|php|node|nodejs|lua)\d+(?:\.\d+)*$/.test(name)) {
    return `Always allow isn't offered for ${name}, because it can run anything.`;
  }
  const subcommands = TWO_WORD_WRAPPERS[name];
  if (subcommands !== undefined) {
    const rest = command
      .trim()
      .split(/[ \t]+/)
      .slice(1)
      .map((word) => word.replace(/["']/g, '').split('=')[0]!);
    // The subcommand is the first non-flag word (`npm test init` runs `test`). A flag before it may
    // take the next word as its value (`npm --prefix dir exec x`), so then every later word counts.
    const position = rest.findIndex((word) => !word.startsWith('-'));
    const candidates = position === 0 ? rest.slice(0, 1) : rest;
    const sub = candidates.find((word) => subcommands.has(word));
    if (sub !== undefined) return `Always allow isn't offered for ${name} ${sub}, because it can run anything.`;
  }
  return undefined;
}

/**
 * Why Always allow isn't offered on a card of a chat in Skip all (permission
 * modes): such a chat never writes rules, and no rule or caution level
 * answers its requests. Core refuses the scope with it; the card writes it.
 */
export const SKIP_ALL_REFUSAL = "Always allow isn't offered while this chat is in Skip all, so it never writes a rule.";
