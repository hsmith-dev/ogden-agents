/**
 * The server-side folder browser behind Add project (story 2.5): a browser
 * page can't hand the server a local path, so the server lists folders and
 * creates a new project folder for it. A plain filesystem read with no
 * database and no domain rule, so it lives here and not in core (AD-1);
 * opening the chosen folder still goes through core, which guards the data
 * folder (AD-11).
 *
 * It reaches the whole disk, starting at the home folder. On macOS and Linux
 * the top is `/` (`parent: null`); on Windows the top is the list of drive
 * roots, at the path {@link DRIVES}, which is every drive root's parent.
 */
import { mkdir, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { FolderEntry, FolderListing } from '@ogden-agents/shared';

/** On Windows, the path of the drive list above every drive root. */
export const DRIVES = '\\';

/** A refused folder request, with a plain message for the user (400). It never holds the path. */
export class FolderError extends Error {
  override readonly name = 'FolderError';
}

const windows = () => process.platform === 'win32';

/** Characters a Windows file name can't hold (and NUL, which no platform allows). */
const WINDOWS_RESERVED = /[<>:"|?*\u0000-\u001f]/;

/** Device names Windows reserves, alone or with any extension (`con.txt`); refused everywhere, so a project moves between systems. */
const RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

/**
 * A network path: UNC (`\\host\share`, `//host/share`) or a Windows device
 * path (`\\?\…`, `\\.\…`, which this browser does not normalize). Refused
 * before any filesystem call, so the server never opens an SMB connection.
 */
const NETWORK_PATH = /^[\\/]{2}/;

/** The folder at `path` as it is on disk; throws {@link FolderError} if it isn't one. */
async function folderAt(path: string): Promise<string> {
  if (NETWORK_PATH.test(path)) throw new FolderError("Network folders aren't supported yet. Choose a folder on this computer.");
  if (!isAbsolute(path) || path.includes('\u0000')) {
    throw new FolderError('Enter the full path of the folder, starting from the top of the disk.');
  }
  const full = resolve(path);
  let isDirectory: boolean;
  try {
    isDirectory = (await stat(full)).isDirectory();
  } catch (error) {
    throw plain(error);
  }
  if (!isDirectory) throw new FolderError('That is a file, not a folder.');
  return full;
}

/** Plain words for each filesystem error code; none of them names the path. */
const PLAIN: Readonly<Record<string, string>> = {
  ENOENT: 'There is no folder at that path on this computer.',
  ENOTDIR: 'There is no folder at that path on this computer.',
  EACCES: "Ogden Agents can't open that folder: permission denied.",
  EPERM: "Ogden Agents can't open that folder: permission denied.",
  ENAMETOOLONG: 'That path or folder name is too long.',
  ELOOP: 'That path has too many links to follow.',
  EROFS: "That disk is read-only, so a folder can't be created there.",
  EINVAL: 'That is not a valid folder name or path.',
  EBUSY: 'That folder is busy. Try again in a moment.',
};

/**
 * A filesystem error as a {@link FolderError} with a plain message: its own
 * message holds the path, so it must never reach the log or the response.
 * Anything that is not a filesystem error (no `code`) is rethrown as is.
 */
function plain(error: unknown): Error {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code !== 'string') return error instanceof Error ? error : new Error(String(error));
  return new FolderError(PLAIN[code] ?? "Ogden Agents can't open that folder.");
}

/** By name ignoring case; names differing only in case keep a stable order. */
const byName = (a: FolderEntry, b: FolderEntry) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Whether `path` exists; any error counts as no. */
const exists = (path: string) => stat(path).then(() => true, () => false);

/** The drive roots that exist (Windows), checked in parallel so one slow drive doesn't hold up the rest. */
async function drives(): Promise<FolderListing> {
  const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode('A'.charCodeAt(0) + i));
  const found = await Promise.all(letters.map(async (letter) => ((await exists(`${letter}:\\`)) ? letter : undefined)));
  const entries = found.filter((letter) => letter !== undefined).map((letter) => ({ name: `${letter}:`, path: `${letter}:\\` }));
  return { path: DRIVES, parent: null, entries };
}

/**
 * The folder at `path` (the home folder when it is `undefined`) with its
 * subfolders, sorted by name ignoring case. Files are left out; a link to a
 * folder counts as a folder. Throws {@link FolderError} when `path` is not
 * absolute, is a network path, is missing, is not a folder or can't be read.
 */
export async function listFolder(path: string | undefined): Promise<FolderListing> {
  if (windows() && (path === DRIVES || path === '/')) return drives();
  const folder = await folderAt(path ?? homedir());
  let dirents;
  try {
    dirents = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    throw plain(error);
  }
  const listed = await Promise.all(
    dirents.map(async (dirent): Promise<FolderEntry | undefined> => {
      const child = join(folder, dirent.name);
      let isFolder = dirent.isDirectory();
      if (!isFolder && dirent.isSymbolicLink()) {
        // A broken link is not a folder.
        isFolder = await stat(child).then((target) => target.isDirectory(), () => false);
      }
      return isFolder ? { name: dirent.name, path: child } : undefined;
    }),
  );
  const entries = listed.filter((entry) => entry !== undefined).sort(byName);
  const up = dirname(folder);
  const parent = up !== folder ? up : windows() ? DRIVES : null;
  return { path: folder, parent, entries };
}

/**
 * Creates the folder `name` inside `parent` and returns its path. Throws
 * {@link FolderError} when `parent` is not an existing local folder, the name
 * can't be a folder name (on any system), or a folder (or file) with that
 * name already exists.
 */
export async function createFolder(parent: string, name: string): Promise<string> {
  if (windows() && (WINDOWS_RESERVED.test(name) || /[. ]$/.test(name))) {
    throw new FolderError('A folder name cannot contain < > : " | ? * or end with a dot or space.');
  }
  if (name.includes('\u0000')) throw new FolderError('That is not a valid folder name.');
  if (RESERVED_NAMES.test(name)) throw new FolderError('That name is reserved by Windows. Choose another name.');
  const path = join(await folderAt(parent), name);
  try {
    await mkdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new FolderError('A folder with that name already exists.');
    throw plain(error);
  }
  return path;
}
