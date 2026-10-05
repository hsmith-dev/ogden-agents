/**
 * The `config.toml` Ogden Agents writes into Codex's own home folder
 * (`CODEX_HOME`, inside the data folder), so Codex starts the way Ogden needs
 * it to (epic 12 entry 5, from the pinned 0.159.3 binary, probed on macOS):
 *
 * - `cli_auth_credentials_store = "ephemeral"`: the API key given at start
 *   stays in Codex's memory. Without it `authenticate` writes the key into a
 *   plain `auth.json` beside the config (AD-16: no key on disk outside the
 *   keychain). Ogden gives the key again at every start.
 * - `features.plugins = false`: Codex downloads OpenAI's plugins repository
 *   into `CODEX_HOME/.tmp/plugins` at its first session otherwise. With the
 *   feature off the folder is never made.
 *
 * Only this one file is written, only into the home Ogden gave it, never
 * `~/.codex`.
 */
import { chmodSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** What Ogden's `config.toml` says. */
export const CODEX_CONFIG_TOML = `# Written by Ogden Agents; changes here are replaced at the next start.
cli_auth_credentials_store = "ephemeral"

[features]
plugins = false
`;

/** Writes {@link CODEX_CONFIG_TOML} into \`home\` unless it is there already. Throws the file system's error. */
export function ensureCodexConfig(home: string): void {
  const file = join(home, 'config.toml');
  try {
    if (readFileSync(file, 'utf8') === CODEX_CONFIG_TOML) return;
  } catch {
    // Not there yet.
  }
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(home, 0o700);
  // A link (or anything but a plain file) in its place is removed, never written through.
  try {
    if (!lstatSync(file).isFile()) unlinkSync(file);
  } catch {
    // Not there.
  }
  writeFileSync(file, CODEX_CONFIG_TOML, { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(file, 0o600);
}
