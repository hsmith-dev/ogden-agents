import { expect, it } from 'vitest';
import { GlobalMcpServer } from '../src/chat.js';
const remote = (name: string, value: string) => ({ name: 'remote', type: 'http', url: 'https://example.com/mcp', headers: [{ name, value }] });
it('rejects unsupported authorization schemes case insensitively at settings validation', () => {
  for (const name of ['Authorization', 'aUtHoRiZaTiOn', 'Proxy-Authorization']) {
    for (const value of ['Token private-value', 'Digest private-value', 'Bearer', 'Basic']) {
      const parsed = GlobalMcpServer.safeParse(remote(name, value));
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues[0]?.message).toContain('Bearer or Basic');
    }
    for (const value of ['', '  ', 'bEaReR private-value', 'basic dXNlcjpwYXNz']) expect(GlobalMcpServer.safeParse(remote(name, value)).success).toBe(true);
  }
  expect(GlobalMcpServer.safeParse(remote('X-Mode', 'Token ordinary-value')).success).toBe(true);
});
