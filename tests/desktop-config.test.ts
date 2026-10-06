/**
 * The desktop shell's AD-15 guard rails (story 13.3, E13-R3), checked on its files: the Tauri
 * config grants the server's origin no IPC and no capability, the window is made in Rust with a
 * navigation guard, and the shell never passes a launch URL on a command line. The behaviour is
 * checked in CI against the built app (Desktop workflow); this keeps a careless edit from reaching it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const TAURI = join(import.meta.dirname, '..', 'packages', 'desktop', 'src-tauri');
const config = JSON.parse(readFileSync(join(TAURI, 'tauri.conf.json'), 'utf8')) as Record<string, any>;
const sources = Object.fromEntries(readdirSync(join(TAURI, 'src')).filter((name) => name.endsWith('.rs')).map((name) => [name, readFileSync(join(TAURI, 'src', name), 'utf8')]));
/** Every Rust source of the shell, as one text. */
const main = Object.values(sources).join('\n');

describe('the app version', () => {
  it('is the package version in the Tauri config and the crate, so a release builds the version it names', () => {
    const { version } = JSON.parse(readFileSync(join(TAURI, '..', '..', '..', 'package.json'), 'utf8')) as { version: string };
    expect(config.version).toBe(version);
    expect(/^version = "([^"]+)"/m.exec(readFileSync(join(TAURI, 'Cargo.toml'), 'utf8'))?.[1]).toBe(version);
    expect(JSON.parse(readFileSync(join(TAURI, '..', 'package.json'), 'utf8')).version).toBe(version);
  });
});

describe('the Tauri config', () => {
  it('uses the app identifier, not the launcher shortcut bundle id', () => {
    expect(config.identifier).toBe('dev.ogden-agents.app');
    expect(config.identifier).not.toBe('dev.ogden-agents.launcher');
  });

  it('packages one universal-capable app per platform: ad-hoc signed, a Node-24-compatible macOS floor, the NSIS installer with the WebView2 bootstrapper, no updater artifacts until a key is given', () => {
    expect(config.bundle.macOS.signingIdentity).toBe('-');
    // Node 24 does not run below macOS 13.5.
    expect(config.bundle.macOS.minimumSystemVersion).toBe('13.5');
    expect(config.bundle.windows.webviewInstallMode).toEqual({ type: 'downloadBootstrapper' });
    expect(config.bundle.windows.nsis.installMode).toBe('currentUser');
    // The updater key is the user's (AD-23): the committed config builds no updater artifacts; CI test builds and releases switch them on.
    expect(config.bundle.createUpdaterArtifacts).toBe(false);
    // Plain http for the updater is for CI test builds only (their override file), never the committed config or a release.
    expect(JSON.stringify(config)).not.toContain('dangerousInsecureTransportProtocol');
    expect(config.plugins.updater.windows.installMode).toBe('passive');
    expect(config.bundle.externalBin).toEqual(['binaries/ogden-node']);
    expect(config.bundle.linux.deb.depends).toEqual(expect.arrayContaining(['libwebkit2gtk-4.1-0', 'libsecret-1-0']));
  });

  it('has no window of its own, no global Tauri object and no remote IPC access', () => {
    expect(config.app.windows).toEqual([]);
    expect(config.app.withGlobalTauri).toBe(false);
    const text = JSON.stringify(config);
    for (const dangerous of ['dangerousRemoteDomainIpcAccess', 'dangerousDisableAssetCspModification', 'devUrl', 'frontendDist": "http']) expect(text, dangerous).not.toContain(dangerous);
  });

  it('grants no capability to the server origin: no capability file has a permission or a remote scope', () => {
    const dir = join(TAURI, 'capabilities');
    const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : [];
    for (const name of files) {
      const capability = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>;
      expect(capability.remote, `${name} has a remote scope`).toBeUndefined();
      expect(capability.permissions, `${name} grants permissions`).toEqual([]);
    }
  });
});

describe('the shell source', () => {
  it('builds the window itself on the server origin and locks navigation to it', () => {
    expect(main).toContain('WebviewUrl::External');
    expect(main).toContain('.on_navigation(');
    expect(main).toContain('fn same_origin');
    // Off-origin links open in the system browser and never in the window, and a new window is always denied.
    expect(main).toContain('NewWindowResponse::Deny');
  });

  it('never puts the launch URL on a command line or in a log', () => {
    expect(main).not.toMatch(/\.arg\([^)]*launch_url/);
    expect(main).not.toMatch(/(?:println|eprintln|report)!?\([^;]*launch_url/);
    // The launcher token is read from the data folder and sent only to the loopback handshake.
    expect(main).not.toMatch(/report\([^;]*token/);
  });

  it('registers the single-instance plugin first, so a second launch hands over before anything else starts', () => {
    const builder = sources['main.rs']!;
    const first = builder.indexOf('.plugin(');
    expect(builder.slice(first, first + 80)).toContain('tauri_plugin_single_instance');
  });

  it('quits a server only through the one quit path, which leaves a server the app only attached to running', () => {
    expect(sources['ui.rs']).toContain('pub fn request_quit');
    expect(sources['server.rs']).toContain('if !owned');
    expect(sources['server.rs']).toContain("report(\"quit_not_ours\"");
  });

  it('adds no Tauri plugin that gives the web page IPC (the updater, menu and single-instance run in Rust only)', () => {
    const cargo = readFileSync(join(TAURI, 'Cargo.toml'), 'utf8');
    expect(cargo).not.toContain('tauri-plugin-localhost');
    expect(cargo).not.toContain('tauri-plugin-shell');
  });
});
