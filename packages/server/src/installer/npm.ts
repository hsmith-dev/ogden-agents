import { existsSync, realpathSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';

/**
 * npm's own CLI script (`npm-cli.js`), so npm runs as `node npm-cli.js` with no
 * shell and no `npm.cmd`: first beside this Node (how Node's installers lay it
 * out), then through an `npm` found in an absolute `PATH` entry (a Node from a
 * version manager or package manager keeps npm elsewhere). `undefined` when
 * there is none.
 */
export function findNpmCli(execPath: string = process.execPath, pathVar: string | undefined = process.env.PATH ?? process.env.Path): string | undefined {
  const candidates: string[] = [];
  const beside = (dir: string) => {
    candidates.push(join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  };
  for (const path of [execPath, safeRealpath(execPath)]) beside(dirname(path));
  for (const dir of (pathVar ?? '').split(delimiter)) {
    // Relative entries (`.`, an empty one) would pick up a planted file from the current folder.
    if (dir === '' || !isAbsolute(dir)) continue;
    beside(dir);
    // A POSIX `npm` is a symlink to npm-cli.js.
    const shim = safeRealpath(join(dir, 'npm'));
    if (shim.endsWith('npm-cli.js')) candidates.push(shim);
  }
  return candidates.find((candidate) => existsSync(candidate));
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
