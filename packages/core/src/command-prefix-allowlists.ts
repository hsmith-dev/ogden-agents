/**
 * What a saved "commands starting with" rule may cover (AD-40, epic 26 story
 * 8, independent security review 2026-10-31). Per-option blocklists leak (git
 * takes abbreviated long options, glued short values, and options that run a
 * program turn up in every release), so for the programs where an option or
 * a subcommand can run another command, a prefix rule matches only what is on
 * an explicit allowlist here and refuses everything else. Pure, text only;
 * paths are checked apart, on the filesystem.
 *
 * Words are compared exactly: an abbreviation of an allowed option (which git
 * and bsdtar would accept) is not on the list, so it refuses, and git takes
 * an exact option name over any abbreviation, so an exact listed name can't
 * mean another option.
 */

/** Programs no prefix rule ever covers: they reach other machines or containers, or run as another user. */
export const PREFIX_NEVER_PROGRAMS: ReadonlySet<string> = new Set([
  // Remote shells and copies: their arguments name commands or hosts.
  'ssh',
  'scp',
  'sftp',
  'rsync',
  'telnet',
  // Containers and clusters: running one is running anything, often as root.
  'docker',
  'podman',
  'docker-compose',
  'podman-compose',
  'nerdctl',
  'kubectl',
  'oc',
  'helm',
  // Another user.
  'sudo',
  'doas',
  'su',
  'pkexec',
  'runuser',
  // Arguments that run a command or an editor (`sed 's/x/y/e'`, `vim -c '!x'`).
  'sed',
  'gsed',
  'vi',
  'vim',
  'nvim',
  'view',
  'emacs',
  'ed',
  'ex',
  'less',
  'more',
  'man',
  'crontab',
  // Package runners that download and run a package.
  'npx',
  'pnpx',
  'bunx',
  // Archive and patch tools write the paths their input names, not the paths the command shows.
  'unzip',
  '7z',
  '7za',
  'cpio',
  'patch',
]);

/** Per program not on an allowlist below, options by which it runs another command: a command holding one is never covered by a prefix. */
export const PREFIX_UNSAFE_OPTIONS: Readonly<Record<string, RegExp>> = {
  find: /^-(?:exec|execdir|ok|okdir)$/,
  zip: /^--unzip-command(?:=|$)|^-[A-Za-z]*T/,
  make: /^--eval(?:=|$)/,
};

/**
 * One subcommand's allowlist. `flags` are words allowed as they are, `values`
 * options that take the next word as their value (or, for a long one, after
 * `=`), `patterns` whole words allowed by shape (`-n5`, `-U3`). `positionals`
 * says what plain words may follow: `any`, `none`, `listed` (only with one of
 * `listFlags`, as `git branch --list x`), or `after-dashes` (only after a
 * bare `--`, as `git checkout -- src`).
 */
interface Allowlist {
  readonly flags?: readonly string[];
  readonly values?: readonly string[];
  readonly patterns?: readonly RegExp[];
  readonly positionals: 'any' | 'none' | 'listed' | 'after-dashes';
  readonly listFlags?: readonly string[];
}

/** Whether `args` (quotes removed, with `raw` the same words as written) keep to `list`. A bare `--` ends the options. */
function keepsTo(list: Allowlist, args: readonly string[], raw: readonly string[]): boolean {
  const flags = new Set(list.flags ?? []);
  const values = new Set(list.values ?? []);
  let positional = false;
  let listed = false;
  let dashes = false;
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]!;
    if (!dashes && raw[index] === '--') {
      dashes = true;
      continue;
    }
    if (!dashes && word.startsWith('-')) {
      if (flags.has(word)) {
        if (list.listFlags?.includes(word) === true) listed = true;
        continue;
      }
      if (values.has(word)) {
        // The value is the next word, whatever it holds (the path check still reads it).
        if (index + 1 >= args.length) return false;
        index += 1;
        continue;
      }
      const equals = word.indexOf('=');
      if (word.startsWith('--') && equals > 0 && values.has(word.slice(0, equals))) continue;
      if (list.patterns?.some((pattern) => pattern.test(word)) === true) continue;
      return false;
    }
    if (list.positionals === 'none') return false;
    if (list.positionals === 'after-dashes' && !dashes) return false;
    positional = true;
  }
  if (positional && list.positionals === 'listed' && !listed) return false;
  return true;
}

const GIT_DIFF_FLAGS = [
  '--stat',
  '--shortstat',
  '--numstat',
  '--name-only',
  '--name-status',
  '--no-color',
  '--color',
  '--no-ext-diff',
  '--no-textconv',
  '-p',
  '--patch',
  '-w',
  '--ignore-all-space',
  '--word-diff',
  '--no-renames',
];

/**
 * Git subcommands a prefix rule may cover, each with its options (security
 * review 2026-10-31): the read-only ones, plus `add`, `commit` with a message
 * and `restore` or `checkout -- <paths>`. Every other subcommand (`grep -O`,
 * `clone -u`, `rebase -x`, `push`, `fetch`, aliases, ...) asks.
 */
const GIT_ALLOWLISTS: Readonly<Record<string, Allowlist>> = {
  status: {
    flags: ['-s', '--short', '-b', '--branch', '-sb', '--long', '-v', '--verbose', '--porcelain', '--porcelain=v1', '--porcelain=v2', '--ignored', '-uno', '-unormal', '-uall', '--untracked-files=no', '--untracked-files=normal', '--untracked-files=all', '--no-renames'],
    positionals: 'any',
  },
  diff: { flags: [...GIT_DIFF_FLAGS, '--cached', '--staged', '--check', '--exit-code', '--quiet'], patterns: [/^-U\d+$/, /^--unified=\d+$/], positionals: 'any' },
  log: {
    flags: [...GIT_DIFF_FLAGS, '--oneline', '--graph', '--decorate', '--all', '--no-merges', '--merges', '--reverse', '--first-parent', '--follow', '--abbrev-commit'],
    values: ['-n', '--max-count', '--since', '--until', '--after', '--before', '--author', '--grep'],
    patterns: [/^-n\d+$/, /^-\d+$/],
    positionals: 'any',
  },
  show: { flags: [...GIT_DIFF_FLAGS, '--oneline', '--no-patch', '-s', '--abbrev-commit'], positionals: 'any' },
  branch: { flags: ['--list', '-l', '-a', '--all', '-v', '-vv', '--verbose', '-r', '--remotes', '--show-current'], listFlags: ['--list', '-l'], positionals: 'listed' },
  'rev-parse': {
    flags: ['--abbrev-ref', '--short', '--show-toplevel', '--git-dir', '--is-inside-work-tree', '--verify', '--symbolic-full-name', '--show-prefix', '--show-cdup', '-q', '--quiet'],
    positionals: 'any',
  },
  'ls-files': {
    flags: ['-o', '--others', '-c', '--cached', '-m', '--modified', '-d', '--deleted', '-s', '--stage', '--exclude-standard', '--full-name', '--error-unmatch', '-z'],
    positionals: 'any',
  },
  blame: { flags: ['-w', '-s', '-l', '-e', '--show-email', '--porcelain', '--line-porcelain'], values: ['-L'], patterns: [/^-L\d+(?:,[+-]?\d*)?$/], positionals: 'any' },
  describe: { flags: ['--tags', '--always', '--dirty', '--long', '--exact-match'], patterns: [/^--abbrev=\d+$/], positionals: 'any' },
  tag: { flags: ['--list', '-l', '-n'], values: ['--contains', '--merged', '--no-merged'], patterns: [/^-n\d+$/], listFlags: ['--list', '-l'], positionals: 'listed' },
  add: { flags: ['-A', '--all', '-u', '--update', '-v', '--verbose'], positionals: 'any' },
  // A message is required: `git commit` alone opens an editor.
  commit: { flags: ['-a', '--all', '-q', '--quiet', '-v', '--verbose'], values: ['-m', '--message', '-am'], positionals: 'any' },
  restore: { flags: ['--staged', '-S', '--worktree', '-W'], positionals: 'any' },
  checkout: { positionals: 'after-dashes' },
};

/** Git options before the subcommand that a prefix rule may cover. Every other one (`-c`, `-C`, `--git-dir`, `--exec-path`, ...) asks. */
const GIT_GLOBAL_FLAGS: ReadonlySet<string> = new Set(['--no-pager', '-P', '--no-optional-locks']);

function gitKeepsToAllowlist(args: readonly string[], raw: readonly string[]): boolean {
  let index = 0;
  while (index < args.length && args[index]!.startsWith('-')) {
    if (!GIT_GLOBAL_FLAGS.has(args[index]!)) return false;
    index += 1;
  }
  // Case matters: `git STATUS` on a case-insensitive disk can run `git-status` or an alias.
  const sub = args[index];
  if (sub === undefined || raw[index] !== sub) return false;
  const list = Object.hasOwn(GIT_ALLOWLISTS, sub) ? GIT_ALLOWLISTS[sub] : undefined;
  if (list === undefined) return false;
  const rest = args.slice(index + 1);
  const restRaw = raw.slice(index + 1);
  if (sub === 'commit' && !rest.some((word) => word === '-m' || word === '-am' || word === '--message' || word.startsWith('--message='))) return false;
  if (sub === 'checkout' && restRaw[0] !== '--') return false;
  return keepsTo(list, rest, restRaw);
}

/** Tar letters a prefix rule may cover: list mode only (`t`), verbose, the built-in decompressors, and `f` for the archive. */
const TAR_LETTERS = /^[tvzjJf]+$/;

/**
 * Tar, list mode only (security review 2026-10-31): `-t`/`--list` with `-f`,
 * `-v` and the built-in decompressors. Extracting is not covered, because an
 * archive can hold paths the command does not show (`.git/hooks/...`).
 */
function tarKeepsToAllowlist(args: readonly string[], raw: readonly string[]): boolean {
  let listMode = false;
  let index = 0;
  const cluster = (letters: string): boolean => {
    if (!TAR_LETTERS.test(letters) || (letters.includes('f') && !letters.endsWith('f'))) return false;
    if (letters.includes('t')) listMode = true;
    // `f` takes the next word as the archive (the path check still reads it).
    if (letters.endsWith('f')) {
      if (index + 1 >= args.length) return false;
      index += 1;
    }
    return true;
  };
  // Old style: the first word is the letters without a dash (`tar tf a.tar`).
  if (args[0] !== undefined && !args[0].startsWith('-')) {
    if (!cluster(args[0])) return false;
    index += 1;
  }
  for (; index < args.length; index += 1) {
    const word = args[index]!;
    if (raw[index] === '--') return false;
    if (word === '--list') listMode = true;
    else if (['--verbose', '--gzip', '--gunzip', '--bzip2', '--xz'].includes(word)) continue;
    else if (word === '--file' || word === '-C' || word === '--directory') {
      if (index + 1 >= args.length) return false;
      index += 1;
    } else if (word.startsWith('--file=') || word.startsWith('--directory=')) continue;
    else if (word.startsWith('--')) return false;
    else if (word.startsWith('-')) {
      if (!cluster(word.slice(1))) return false;
    }
  }
  return listMode;
}

/** npm, pnpm and yarn subcommands a prefix rule may cover: running the project's own scripts, and installing the lockfile. */
const NPM_SCRIPT_SUBCOMMANDS: ReadonlySet<string> = new Set(['test', 'run', 'run-script', 'lint', 'build']);
const NPM_INSTALL_SUBCOMMANDS: ReadonlySet<string> = new Set(['install', 'ci']);
const NPM_SCRIPT_FLAGS: Allowlist = { flags: ['--silent', '-s', '--if-present', '--workspaces', '-ws', '--include-workspace-root'], values: ['--workspace', '-w'], positionals: 'any' };
const NPM_INSTALL_FLAGS: Allowlist = {
  flags: ['--silent', '-s', '--no-audit', '--no-fund', '--prefer-offline', '--offline', '--ignore-scripts', '--frozen-lockfile', '--immutable', '--legacy-peer-deps', '--omit=dev', '--production'],
  positionals: 'none',
};

/**
 * npm, pnpm and yarn (security review 2026-10-31): `test`, `run <script>`,
 * `run-script`, `lint`, `build`, and `install` or `ci` with no package named.
 * Options npm reads before a bare `--` must be on the list (`--script-shell`,
 * `--node-options` are not); after it, words go to the script. An
 * abbreviation (`npm exe`) is not on the list, so it asks.
 */
function npmKeepsToAllowlist(args: readonly string[], raw: readonly string[]): boolean {
  const sub = args[0];
  if (sub === undefined) return true;
  if (raw[0] !== sub) return false;
  if (NPM_SCRIPT_SUBCOMMANDS.has(sub)) return keepsTo(NPM_SCRIPT_FLAGS, args.slice(1), raw.slice(1));
  if (NPM_INSTALL_SUBCOMMANDS.has(sub)) return !raw.slice(1).includes('--') && keepsTo(NPM_INSTALL_FLAGS, args.slice(1), raw.slice(1));
  return false;
}

/** Go flags (one or two dashes, a value after `=` or as the next word) a prefix rule may cover; `-exec`, `-toolexec`, `-vettool`, `-overlay` and the rest ask. */
const GO_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['v', 'race', 'short', 'cover', 'failfast', 'json', 'benchmem', 'x', 'n', 'a', 'trimpath']);
const GO_VALUE_FLAGS: ReadonlySet<string> = new Set(['count', 'run', 'skip', 'timeout', 'bench', 'benchtime', 'o', 'tags', 'p', 'parallel', 'cpu', 'coverprofile', 'covermode']);

/** Go: `go test`, `go build` and `go vet` only, never `go run` (security review 2026-10-31). */
function goKeepsToAllowlist(args: readonly string[], raw: readonly string[]): boolean {
  const sub = args[0];
  if (sub === undefined || raw[0] !== sub || !['test', 'build', 'vet'].includes(sub)) return false;
  for (let index = 1; index < args.length; index += 1) {
    const word = args[index]!;
    if (!word.startsWith('-')) continue;
    const [name, value] = (() => {
      const bare = word.replace(/^--?/, '');
      const equals = bare.indexOf('=');
      return equals < 0 ? [bare, undefined] : [bare.slice(0, equals), bare.slice(equals + 1)];
    })();
    if (GO_BOOLEAN_FLAGS.has(name) && (value === undefined || value === 'true' || value === 'false')) continue;
    if (!GO_VALUE_FLAGS.has(name)) return false;
    if (value === undefined) {
      if (index + 1 >= args.length) return false;
      index += 1;
    }
  }
  return true;
}

/** Programs whose prefix rules keep to an allowlist: the words after the program name, quotes removed, and as written. */
const PREFIX_ALLOWLISTS: Readonly<Record<string, (args: readonly string[], raw: readonly string[]) => boolean>> = {
  git: gitKeepsToAllowlist,
  tar: tarKeepsToAllowlist,
  gtar: tarKeepsToAllowlist,
  bsdtar: tarKeepsToAllowlist,
  npm: npmKeepsToAllowlist,
  pnpm: npmKeepsToAllowlist,
  yarn: npmKeepsToAllowlist,
  go: goKeepsToAllowlist,
};

/**
 * Whether a prefix rule must not cover a command led by `name` with these
 * words after it (`args` with quotes removed, `raw` as written): a program
 * that never matches, one off its allowlist, or an option that runs another
 * command.
 */
export function prefixRefusedFor(name: string, args: readonly string[], raw: readonly string[]): boolean {
  if (PREFIX_NEVER_PROGRAMS.has(name)) return true;
  const allowlist = Object.hasOwn(PREFIX_ALLOWLISTS, name) ? PREFIX_ALLOWLISTS[name] : undefined;
  if (allowlist !== undefined) return !allowlist(args, raw);
  const unsafe = Object.hasOwn(PREFIX_UNSAFE_OPTIONS, name) ? PREFIX_UNSAFE_OPTIONS[name] : undefined;
  return unsafe !== undefined && args.some((word) => unsafe.test(word));
}

/**
 * The index among a command's words of an npm, pnpm or yarn script name
 * (`npm run test:unit`): a name, not a path or a host, so the remote-path
 * check passes it over. `undefined` when there is none.
 */
export function scriptNameIndex(given: readonly string[], name: string): number | undefined {
  if (!['npm', 'pnpm', 'yarn'].includes(name)) return undefined;
  if (given[1] !== 'run' && given[1] !== 'run-script') return undefined;
  const script = given[2];
  return script !== undefined && /^[A-Za-z0-9][A-Za-z0-9:_.-]*$/.test(script) ? 2 : undefined;
}
