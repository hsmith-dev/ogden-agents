import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InstallToolCard } from '../src/dev-tools/install-tool-card';

describe('the dev tool install confirmation card (CAP-25, AC2)', () => {
  it('shows the exact command and offers Install or Cancel, never a terminal', () => {
    const html = renderToStaticMarkup(
      <InstallToolCard label="Google Cloud CLI" command="curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts" disabled={false} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(html).toContain('Install Google Cloud CLI');
    expect(html).toMatch(/<pre[^>]*data-testid="install-tool-command"[^>]*>curl -sSL https:\/\/sdk\.cloud\.google\.com \| bash -s -- --disable-prompts<\/pre>/);
    expect(html).toMatch(/data-testid="install-tool-confirm"[^>]*>\s*Install\s*</);
    expect(html).toMatch(/data-testid="install-tool-cancel"[^>]*>\s*Cancel\s*</);
    expect(html).not.toMatch(/open a terminal|paste (this|it) into (a|your) terminal|run this yourself|\bnpx\b/i);
  });

  it('disables both buttons while installing, so a second click never starts a second real command', () => {
    const html = renderToStaticMarkup(<InstallToolCard label="Docker" command="curl -fsSL https://get.docker.com | sh" disabled={true} onConfirm={() => {}} onCancel={() => {}} />);
    expect(html).toMatch(/aria-disabled="true"[^>]*data-testid="install-tool-confirm"|data-testid="install-tool-confirm"[^>]*aria-disabled="true"/);
    expect(html).toMatch(/aria-disabled="true"[^>]*data-testid="install-tool-cancel"|data-testid="install-tool-cancel"[^>]*aria-disabled="true"/);
  });
});
