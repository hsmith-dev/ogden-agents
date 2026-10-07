// @vitest-environment happy-dom
import { TooltipProvider } from '../src/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ servers: [] as unknown[], skills: [] as any[], bodies: [] as any[], fail: false }));
vi.mock('@/auth/tab-token', () => ({ tabAuth: { fetch: async (path: string, init: RequestInit = {}) => {
  const method = init.method ?? 'GET';
  if (method !== 'GET') {
    if (state.fail) return new Response(JSON.stringify({ error: { message: 'Could not save.' } }), { status: 500 });
    const body = init.body === undefined ? undefined : JSON.parse(String(init.body));
    state.bodies.push(body);
    if (path.endsWith('/global-mcp-servers')) state.servers = body.servers;
    else if (method === 'DELETE') state.skills = [];
    else state.skills = [body];
  }
  return new Response(JSON.stringify(path.endsWith('/global-mcp-servers') ? { servers: state.servers } : method === 'GET' ? { skills: state.skills } : {}));
} } }));
const { GlobalMcpServersSection } = await import('../src/chat/global-mcp-servers-section');
const { GlobalSkillsSection } = await import('../src/chat/global-skills-section');
const settle = () => act(async () => { for (let index = 0; index < 8; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
async function mount(kind: 'mcp' | 'skills') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><TooltipProvider>{kind === 'mcp' ? <GlobalMcpServersSection /> : <GlobalSkillsSection />}</TooltipProvider></QueryClientProvider>);
  await settle(); return client;
}
const enter = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
beforeEach(() => { state.servers = []; state.skills = []; state.bodies = []; state.fail = false; });
afterEach(cleanup);
it('adds a local MCP server using labeled fields, then removes it', async () => {
  await mount('mcp');
  expect(screen.getByText(/No MCP servers connected/)).toBeTruthy();
  enter('Server name', 'tools'); enter('Command', 'npx'); enter('Arguments (optional)', '-y\nmy-tool'); enter('Environment variables (optional)', 'TOKEN=private-value');
  expect(screen.getByText(/local SQLite database rather/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add MCP server' })); await settle();
  expect(state.servers).toEqual([{ name: 'tools', command: 'npx', args: ['-y', 'my-tool'], env: [{ name: 'TOKEN', value: 'private-value' }] }]);
  expect((screen.getByLabelText('Server name') as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Remove tools' })); await settle(); expect(state.servers).toEqual([]);
});
it('keeps MCP draft and advanced JSON unchanged after refetch, and refuses invalid addresses', async () => {
  const client = await mount('mcp');
  fireEvent.click(screen.getByRole('button', { name: /^HTTP$/ })); enter('Server name', 'draft'); enter('Server address', 'file:///bad');
  fireEvent.click(screen.getByRole('button', { name: 'Add MCP server' })); await settle(); expect(state.bodies).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Advanced JSON editor' })); enter('All servers as JSON', '[draft');
  await client.invalidateQueries({ queryKey: ['global-mcp-servers'] }); await settle();
  expect((screen.getByLabelText('Server name') as HTMLInputElement).value).toBe('draft');
  expect((screen.getByLabelText('All servers as JSON') as HTMLTextAreaElement).value).toBe('[draft');
});
it('saves and edits a shared skill without JSON, preserving unsaved instructions across refetch and failed save', async () => {
  const client = await mount('skills');
  enter('Skill name', 'my-helper'); enter('Instructions', 'Read carefully.'); enter('Group (optional)', 'Writing');
  fireEvent.click(screen.getByRole('button', { name: 'Add shared skill' })); await settle();
  expect(state.skills[0]).toMatchObject({ name: 'my-helper', content: 'Read carefully.', group: 'Writing' });
  fireEvent.click(screen.getByRole('button', { name: 'Edit my-helper' })); enter('Instructions', 'Unsaved changes');
  await client.invalidateQueries({ queryKey: ['global-skills'] }); await settle();
  expect((screen.getByLabelText('Instructions') as HTMLTextAreaElement).value).toBe('Unsaved changes');
  state.fail = true; fireEvent.click(screen.getByRole('button', { name: 'Save skill changes' })); await settle();
  expect((screen.getByLabelText('Instructions') as HTMLTextAreaElement).value).toBe('Unsaved changes');
  expect(screen.getByText(/Your instructions are still in the form/)).toBeTruthy();
});
it('saves a remote server with headers and retains its form when persistence fails', async () => {
  await mount('mcp');
  fireEvent.click(screen.getByRole('button', { name: /^HTTP$/ })); enter('Server name', 'remote'); enter('Server address', 'https://tools.example.com/mcp'); enter('Request headers (optional)', 'Authorization=Bearer private-token');
  state.fail = true; fireEvent.click(screen.getByRole('button', { name: 'Add MCP server' })); await settle();
  expect((screen.getByLabelText('Request headers (optional)') as HTMLTextAreaElement).value).toContain('private-token');
  expect(screen.getByText(/Your entries are still in the form/)).toBeTruthy();
  state.fail = false; fireEvent.click(screen.getByRole('button', { name: 'Add MCP server' })); await settle();
  expect(state.servers).toEqual([{ name: 'remote', type: 'http', url: 'https://tools.example.com/mcp', headers: [{ name: 'Authorization', value: 'Bearer private-token' }] }]);
  expect((screen.getByLabelText('Request headers (optional)') as HTMLTextAreaElement).value).toBe('');
  expect(screen.getByRole('list', { name: 'Connected MCP servers' }).textContent).not.toContain('private-token');
});
it('explains unsupported authorization schemes before saving without discarding the draft', async () => {
  await mount('mcp');
  fireEvent.click(screen.getByRole('button', { name: /^HTTP$/ })); enter('Server name', 'remote'); enter('Server address', 'https://example.com/mcp'); enter('Request headers (optional)', 'authorization=Token private-value');
  fireEvent.click(screen.getByRole('button', { name: 'Add MCP server' })); await settle();
  expect(screen.getByText('MCP authorization headers must use Bearer or Basic credentials.')).toBeTruthy();
  expect(state.bodies).toEqual([]);
  expect((screen.getByLabelText('Request headers (optional)') as HTMLTextAreaElement).value).toBe('authorization=Token private-value');
});
