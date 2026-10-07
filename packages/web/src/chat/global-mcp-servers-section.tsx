import { GlobalMcpServer, GlobalMcpServers, type GlobalMcpServer as Server } from '@ogden-agents/shared';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchGlobalMcpServers, setGlobalMcpServers } from './chat-api';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Notice } from '@/ui/notice';
import { Text } from '@/ui/typography';

function pairs(text: string) {
  return text.split('\n').filter((line) => line.trim() !== '').map((line) => {
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('Enter each variable or header as NAME=value on its own line.');
    return { name: line.slice(0, separator).trim(), value: line.slice(separator + 1) };
  });
}

export function GlobalMcpServersSection() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['global-mcp-servers'], queryFn: () => fetchGlobalMcpServers() });
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'http' | 'sse'>('stdio');
  const [address, setAddress] = useState('');
  const [args, setArgs] = useState('');
  const [credentials, setCredentials] = useState('');
  const [editing, setEditing] = useState<string>();
  const [advanced, setAdvanced] = useState(false);
  const [json, setJson] = useState('');
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  function clear() { setName(''); setAddress(''); setArgs(''); setCredentials(''); setEditing(undefined); setError(undefined); }
  const mutation = useMutation({ mutationFn: (input: { servers: Server[]; clearDraft: boolean }) => setGlobalMcpServers(input.servers), onSuccess: (data, input) => { client.setQueryData(['global-mcp-servers'], data); if (input.clearDraft) { clear(); setAdvanced(false); setJson(''); } setSaved(true); } });
  function submit(servers: unknown, clearDraft = true) {
    const parsed = GlobalMcpServers.safeParse(servers);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the server settings.'); return; }
    setError(undefined); setSaved(false); mutation.mutate({ servers: parsed.data, clearDraft });
  }
  function save(event: React.FormEvent) {
    event.preventDefault();
    try {
      const parsed = GlobalMcpServer.safeParse(transport === 'stdio' ? { name, command: address, args: args.split('\n').filter((line) => line !== ''), env: pairs(credentials) } : { name, type: transport, url: address, headers: pairs(credentials) });
      if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the server settings.'); return; }
      const server = parsed.data;
      const previous = query.data ?? [];
      if (previous.some((item) => item.name === server.name && item.name !== editing)) { setError('This server name already exists. Choose a different name or edit that server.'); return; }
      submit([...previous.filter((item) => item.name !== editing), server]);
    } catch (failure) { setError(failure instanceof Error && failure.message.startsWith('Enter each') ? failure.message : 'Enter a name and a valid command or HTTP/HTTPS server address. Check optional variables and headers.'); }
  }
  function edit(server: Server) { setName(server.name); setEditing(server.name); setTransport('command' in server ? 'stdio' : server.type); setAddress('command' in server ? server.command : server.url); setArgs('command' in server ? server.args.join('\n') : ''); setCredentials(('command' in server ? server.env : server.headers).map((pair) => `${pair.name}=${pair.value}`).join('\n')); setSaved(false); setError(undefined); }
  const disabled = mutation.isPending || query.isPending || query.isError;
  return <section className="flex flex-col gap-4" aria-labelledby="mcp-title">
    <Text as="h2" variant="heading" id="mcp-title">MCP servers</Text>
    <Text tone="muted">Connect tools and data sources to coding agents across your projects. Changes apply when an agent session next starts. Local commands run on this computer.</Text>
    {query.isPending && <Text role="status">Loading MCP servers…</Text>}
    {query.isError && <Notice variant="blocked">MCP servers could not be loaded. <Button onClick={() => void query.refetch()}>Try again</Button></Notice>}
    {query.data?.length === 0 && <Text tone="muted">No MCP servers connected. Add a local tool or a remote server below.</Text>}
    {query.data !== undefined && query.data.length > 0 && <ul aria-label="Connected MCP servers" className="flex flex-col gap-2">{query.data.map((server) => <li key={server.name} className="flex items-center justify-between gap-4"><div><Text>{server.name}</Text><Text variant="caption">{'command' in server ? 'Local command' : server.type.toUpperCase()}</Text></div><div className="flex gap-2"><Button disabled={disabled} aria-label={`Edit ${server.name}`} onClick={() => edit(server)}>Edit</Button><Button disabled={disabled} aria-label={`Remove ${server.name}`} onClick={() => submit(query.data.filter((item) => item.name !== server.name), editing === server.name)}>Remove</Button></div></li>)}</ul>}
    <form onSubmit={save} className="flex flex-col gap-4">
      <Field id="mcp-name" label="Server name"><Input id="mcp-name" disabled={disabled} value={name} onChange={(event) => { setName(event.target.value); setSaved(false); }} /></Field>
      <Field id="mcp-transport" control="group" label="Connection type"><div role="group" aria-labelledby="mcp-transport-label" className="flex flex-wrap gap-2">{(['stdio', 'http', 'sse'] as const).map((choice) => <Button type="button" key={choice} aria-pressed={transport === choice} disabled={disabled} onClick={() => { setTransport(choice); setAddress(''); setCredentials(''); setSaved(false); }}>{choice === 'stdio' ? 'Local command' : choice.toUpperCase()}</Button>)}</div></Field>
      <Field id="mcp-address" label={transport === 'stdio' ? 'Command' : 'Server address'} description={transport === 'stdio' ? 'Enter the executable, for example npx. Add its arguments below.' : 'Enter the HTTP or HTTPS URL supplied by the server.'}><Input id="mcp-address" disabled={disabled} value={address} onChange={(event) => { setAddress(event.target.value); setSaved(false); }} /></Field>
      {transport === 'stdio' && <Field id="mcp-args" label="Arguments (optional)" description="One argument per line. Do not add shell quotes."><Textarea id="mcp-args" disabled={disabled} value={args} onChange={(event) => { setArgs(event.target.value); setSaved(false); }} /></Field>}
      <Field id="mcp-credentials" label={transport === 'stdio' ? 'Environment variables (optional)' : 'Request headers (optional)'} description="One NAME=value per line. These values, including credentials, are stored in the local SQLite database rather than the system keychain. Only enter credentials you trust this computer to keep."><Textarea id="mcp-credentials" disabled={disabled} value={credentials} onChange={(event) => { setCredentials(event.target.value); setSaved(false); }} /></Field>
      <div className="flex gap-2"><Button type="submit" variant="primary" disabled={disabled}>{mutation.isPending ? 'Saving…' : editing === undefined ? 'Add MCP server' : 'Save server changes'}</Button>{(editing !== undefined || name || address) && <Button type="button" disabled={mutation.isPending} onClick={clear}>Cancel editing</Button>}</div>
    </form>
    <Button disabled={disabled} aria-expanded={advanced} onClick={() => { if (!advanced && json === '') setJson(JSON.stringify(query.data ?? [], null, 2)); setAdvanced(!advanced); }}>Advanced JSON editor</Button>
    {advanced && <div className="flex flex-col gap-2"><Field id="mcp-json" label="All servers as JSON" description="Saving replaces the full server list. Credentials are stored in local SQLite."><Textarea id="mcp-json" disabled={disabled} value={json} onChange={(event) => { setJson(event.target.value); setSaved(false); }} /></Field><Button disabled={disabled} onClick={() => { try { submit(JSON.parse(json)); } catch { setError('Enter a valid JSON array of MCP servers.'); } }}>Save all servers</Button></div>}
    {error && <Notice variant="blocked">{error}</Notice>}
    {mutation.isError && <Notice variant="blocked">{mutation.error.message} Your entries are still in the form.</Notice>}
    {saved && <Text role="status">MCP servers saved. Changes apply to new agent sessions.</Text>}
  </section>;
}
