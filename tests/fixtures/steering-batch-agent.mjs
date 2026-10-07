/** Minimal ACP peer: steering acknowledgment, next chunk and prompt end share one write. */
import { createInterface } from 'node:readline';
if (process.argv.includes('--cli')) await import('./fake-acp-agent.mjs');
let pendingPrompt;
let cancels = 0;
const sessionId = 'batch-session';
const response = (id, result) => ({ jsonrpc: '2.0', id, result });
const chunk = (text) => ({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
const write = (...messages) => process.stdout.write(messages.map((message) => JSON.stringify(message)).join('\n') + '\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') write(response(request.id, { protocolVersion: 1, agentCapabilities: {}, authMethods: [], _meta: { steering: { supported: true } } }));
  else if (request.method === 'session/new') write(response(request.id, { sessionId }));
  else if (request.method === 'session/prompt') {
    const text = request.params.prompt.map((block) => block.text ?? '').join('');
    if (text === 'hold') { pendingPrompt = request.id; write(chunk('Holding')); }
    else write(chunk(`cancels=${cancels}`), response(request.id, { stopReason: 'end_turn' }));
  } else if (request.method === '_session/steering') {
    const text = request.params.prompt.map((block) => block.text ?? '').join('');
    write(response(request.id, { outcome: 'injected' }), chunk(`Steered: ${text}.`), response(pendingPrompt, { stopReason: 'end_turn' }));
    pendingPrompt = undefined;
  } else if (request.method === 'session/cancel') cancels++;
  else if (request.id !== undefined) write(response(request.id, {}));
});
