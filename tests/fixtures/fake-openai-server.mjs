// @ts-nocheck
// The fake OpenAI-compatible server (epic 14: the spike probe, then every story).
// No real model, no network: it answers from rules. Records every request it gets
// (path, method, whether a key came, tool names, stream, response_format) so the probe
// can prove what a harness sent and what it did not.
//
// Rules for POST /v1/chat/completions (streaming or not):
//   response_format json_schema  -> a JSON object built from the schema (or broken JSON
//                                   when the last user text contains MALFORMED)
//   user text contains SLOW      -> waits SLOW_MS (default 4000) before the first token
//   user text contains NOTFOUND  -> 404 model_not_found
//   tools present, user text contains "run" and no tool result yet
//                                -> one tool call (the `bash` tool if offered, else the first)
//   after a tool result          -> text "tool said: <first 80 chars of the result>"
//   user text contains MANAGER_CASE:<id> and the `managerCases` option has <id>
//                                -> the scripted manager reply (epic 15 story 15.1): request n gets
//                                   replies[min(n, last)] as plain message text whatever the response_format;
//                                   `hang` never answers until the server closes
//   otherwise                    -> text "Hello from the fake model."
import http from 'node:http';

export function startFakeServer({ port = 0, host = '127.0.0.1', requireKey = null, slowMs = 4000, modelsDelayMs = 0, models = ['fake-small', 'fake-large', 'fake-nojson', 'fake-noformat'], managerCases = {} } = {}) {
  const log = [];
  const caseCounts = new Map();
  const sockets = new Set();
  const lastText = (messages) => {
    const m = [...messages].reverse().find((x) => x.role === 'user');
    if (!m) return '';
    return typeof m.content === 'string' ? m.content : (m.content ?? []).map((p) => p.text ?? '').join(' ');
  };
  const build = (schema) => {
    if (!schema || typeof schema !== 'object') return null;
    if (schema.enum) return schema.enum[0];
    switch (schema.type) {
      case 'object': return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, v]) => [k, build(v)]));
      case 'array': return [build(schema.items)];
      case 'string': return 'ok';
      case 'integer': case 'number': return 1;
      case 'boolean': return true;
      default: return null;
    }
  };
  const sse = (res, chunks, delay = 0) => new Promise((resolve) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    let i = 0;
    const next = () => {
      if (i >= chunks.length) { res.write('data: [DONE]\n\n'); res.end(); return resolve(); }
      res.write(`data: ${JSON.stringify(chunks[i++])}\n\n`);
      delay ? setTimeout(next, delay) : setImmediate(next);
    };
    next();
  });
  const base = (model) => ({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', created: 1, model });

  const server = http.createServer((req, res) => {
    res.on('error', () => {}); req.on('error', () => {});
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      let json = null;
      try { json = body ? JSON.parse(body) : null; } catch {}
      const auth = req.headers.authorization ?? '';
      const entry = {
        t: Date.now(), method: req.method, path: req.url.split('?')[0], host: req.headers.host,
        auth: auth ? 'bearer-present' : 'none', authMatches: requireKey ? auth === `Bearer ${requireKey}` : null,
        ua: req.headers['user-agent'] ?? '',
      };
      if (json) {
        entry.model = json.model; entry.stream = !!json.stream;
        entry.tools = (json.tools ?? []).map((t) => t.function?.name ?? t.name ?? t.type);
        entry.instructionsChars = String(json.instructions ?? '').length || undefined;
        entry.toolChoice = json.tool_choice; entry.responseFormat = json.response_format?.type;
        entry.messageRoles = (json.messages ?? (Array.isArray(json.input) ? json.input : [])).map((m) => m.role ?? m.type);
        if (Array.isArray(json.input)) entry.messageCount = json.input.length;
        const ms = json.messages ?? [];
        if (!Array.isArray(json.input)) entry.messageCount = ms.length;
        entry.userText = lastText(ms).slice(0, 120);
        // The whole of the last user message (capped), so a test can see what a manager was told (15.12).
        entry.promptText = lastText(ms).slice(0, 20000);
        const lt = [...ms].reverse().find((m) => m.role === 'tool');
        if (lt) entry.lastToolContent = (typeof lt.content === 'string' ? lt.content : JSON.stringify(lt.content)).slice(0, 200);
        entry.systemChars = ms.filter((m) => m.role === 'system').reduce((n, m) => n + String(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).length, 0);
        entry.temperature = json.temperature; entry.maxTokens = json.max_tokens ?? json.max_completion_tokens;
      }
      log.push(entry);
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/__log') return send(200, log);
      if (requireKey && auth !== `Bearer ${requireKey}`) return send(401, { error: { message: 'bad key', type: 'invalid_request_error', code: 'invalid_api_key' } });
      const p = entry.path;
      if (req.method === 'GET' && (p === '/v1/models' || p === '/models')) {
        if (modelsDelayMs > 0) await new Promise((r) => setTimeout(r, modelsDelayMs));
        return send(200, { object: 'list', data: models.map((id) => ({ id, object: 'model', created: 1, owned_by: 'fake' })) });
      }
      if (req.method === 'GET' && p === '/api/tags') return send(200, { models: models.map((name) => ({ name, model: name, size: 4_000_000_000, details: { parameter_size: '7B', family: 'fake' } })) });
      // The two native shapes Ogden reads for sizes, context length and tool support (story 14.5). `fake-small` is small, `fake-large` is big with tools.
      const context = (name) => (name === 'fake-small' ? 4096 : name === 'fake-large' ? 32768 : 8192);
      if (req.method === 'POST' && p === '/api/show') {
        const name = json?.model;
        if (!models.includes(name)) return send(404, { error: 'model not found' });
        return send(200, { model_info: { 'fake.context_length': context(name) }, capabilities: name === 'fake-small' ? ['completion'] : ['completion', 'tools'] });
      }
      if (req.method === 'GET' && p === '/api/v0/models') return send(200, { object: 'list', data: models.map((id) => ({ id, object: 'model', type: 'llm', state: 'loaded', max_context_length: context(id) * 2, loaded_context_length: context(id), capabilities: id === 'fake-small' ? [] : ['tool_use'] })) });
      if (req.method === 'GET' && p === '/') return send(200, { ok: true });
      if (req.method === 'POST' && (p === '/v1/chat/completions' || p === '/chat/completions')) {
        const messages = json.messages ?? [];
        const text = lastText(messages);
        const model = json.model;
        if (text.includes('CTXFULL')) return send(400, { error: { message: "This model's maximum context length is 4096 tokens. However, your messages resulted in 9000 tokens. Please reduce the length of the messages.", type: 'invalid_request_error', code: 'context_length_exceeded' } });
        if (text.includes('NOTFOUND')) return send(404, { error: { message: `model '${model}' not found`, type: 'invalid_request_error', code: 'model_not_found' } });
        if (!models.includes(model)) return send(404, { error: { message: `model '${model}' not found`, type: 'invalid_request_error', code: 'model_not_found' } });
        if (model === 'fake-noformat' && json.response_format) return send(400, { error: { message: 'response_format is not supported by this model', type: 'invalid_request_error' } });
        if (model === 'fake-nojson' && json.response_format?.type === 'json_schema') return send(400, { error: { message: "response_format.type 'json_schema' is not supported, use 'json_object' or 'text'", type: 'invalid_request_error' } });
        // Story 15.1: a scripted manager, played on cue by `MANAGER_CASE:<id>` in the first user text (the repair request does not repeat it, so the case is found in any user message).
        const caseId = /MANAGER_CASE:([a-z0-9-]+)/.exec(messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n'))?.[1];
        if (caseId && Object.hasOwn(managerCases, caseId)) {
          const script = managerCases[caseId];
          const n = caseCounts.get(caseId) ?? 0;
          caseCounts.set(caseId, n + 1);
          if (script.hang) { if (!res.destroyed && !res.closed) await new Promise((r) => res.on('close', r)); return; }
          const content = script.replies[Math.min(n, script.replies.length - 1)] ?? '';
          return send(200, { ...base(model), object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });
        }
        // A slow structured answer (story 14.8): the slow first token applies to these requests too.
        if (text.includes('SLOW') && (json.response_format || text.includes('MANAGER_TEST'))) await new Promise((r) => setTimeout(r, slowMs));
        // Story 14.8: a model that only gets it right when asked again (REPAIRABLE), and one whose answer is huge (HUGE).
        const repairing = text.startsWith('That was not valid') && messages.some((m) => m.role === 'user' && String(m.content).includes('REPAIRABLE'));
        if (repairing) return send(200, { ...base(model), object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: '{"verdict":"fit","reason":"ok"}' }, finish_reason: 'stop' }] });
        if (text.includes('HUGE')) return send(200, { ...base(model), object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: `{"verdict":"fit","reason":"${'x'.repeat(400_000)}"}` }, finish_reason: 'stop' }] });
        if (text.includes('REPAIRABLE')) return send(200, { ...base(model), object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'Sure! I think it is fit.' }, finish_reason: 'stop' }] });
        if (!json.response_format && text.includes('MANAGER_TEST')) {
          const content = text.includes('MALFORMED') ? 'Sure! The verdict is fit.' : '```json\n{"verdict":"fit","reason":"ok"}\n```';
          return send(200, { ...base(model), object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });
        }
        if (json.response_format?.type === 'json_schema' || json.response_format?.type === 'json_object') {
          const content = text.includes('MALFORMED') ? '{"answer": "oops",' : JSON.stringify(build(json.response_format.json_schema?.schema) ?? (text.includes('MANAGER_TEST') ? { verdict: 'fit', reason: 'ok' } : { ok: true }));
          return send(200, { ...base(model), object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
        }
        if (text.includes('SLOW')) await new Promise((r) => setTimeout(r, slowMs));
        const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user');
        const hasToolResult = messages.slice(lastUserIdx + 1).some((m) => m.role === 'tool');
        const tools = json.tools ?? [];
        const wantsTool = tools.length && !hasToolResult && /\brun\b/i.test(text);
        let calls = null; let content = null;
        if (wantsTool) {
          const tool = tools.find((t) => /^(bash|shell|execute|run_command)$/.test(t.function?.name ?? '')) ?? tools[0];
          const props = Object.keys(tool.function?.parameters?.properties ?? {});
          const args = {};
          const want = /\becho (\S+)/.exec(text);
          for (const k of props) if (k === 'command') args[k] = want ? `echo ${want[1]}` : 'ls'; else if (k === 'description') args[k] = 'Run the command';
          calls = [{ index: 0, id: 'call_fake_1', type: 'function', function: { name: tool.function?.name, arguments: text.includes('BADARGS') ? '{"command": "echo' : JSON.stringify(args) } }];
        } else if (hasToolResult) {
          const last = [...messages].reverse().find((m) => m.role === 'tool');
          const c = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
          content = `tool said: ${c.slice(0, 80)}`;
        } else content = 'Hello from the fake model.';
        if (!json.stream) {
          return send(200, { ...base(model), object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content, ...(calls ? { tool_calls: calls.map(({ index, ...c }) => c) } : {}) }, finish_reason: calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
        }
        const chunks = [{ ...base(model), choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }];
        if (calls) {
          const c = calls[0];
          chunks.push({ ...base(model), choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: c.id, type: 'function', function: { name: c.function.name, arguments: '' } }] }, finish_reason: null }] });
          const a = c.function.arguments;
          for (let i = 0; i < a.length; i += 12) chunks.push({ ...base(model), choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: a.slice(i, i + 12) } }] }, finish_reason: null }] });
          chunks.push({ ...base(model), choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
        } else {
          for (const w of content.split(/(?<= )/)) chunks.push({ ...base(model), choices: [{ index: 0, delta: { content: w }, finish_reason: null }] });
          chunks.push({ ...base(model), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
        }
        if (json.stream_options?.include_usage) chunks.push({ ...base(model), choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
        return sse(res, chunks, text.includes('SLOW') ? 400 : 0);
      }
      if (req.method === 'POST' && (p === '/v1/responses' || p === '/responses')) {
        // Minimal Responses API stream (route 1, Codex). Text only, plus one shell call when asked to run.
        const model = json.model ?? 'fake-small';
        const items = Array.isArray(json.input) ? json.input : [{ role: 'user', content: String(json.input ?? '') }];
        const userIdx = items.map((i) => i.role).lastIndexOf('user');
        const inputText = JSON.stringify(items.filter((i) => i.role === 'user').slice(-2).map((i) => i.content));
        entry.userText = inputText.slice(0, 120);
        const hasOutput = items.slice(userIdx + 1).some((i) => i.type === 'function_call_output');
        const wantsTool = (json.tools ?? []).length && !hasOutput && /\brun\b/i.test(inputText);
        const id = 'resp_fake';
        const ev = (type, o) => ({ type, ...o });
        const events = [ev('response.created', { response: { id, object: 'response', status: 'in_progress', model, output: [] } })];
        let output;
        if (wantsTool) {
          const tool = (json.tools ?? []).find((t) => /shell|bash|exec/i.test(t.name ?? '')) ?? json.tools[0];
          const props = tool.parameters?.properties ?? {};
          const word = /\becho (\S+)/.exec(inputText)?.[1] ?? 'ogden-probe-ran';
          const args = props.cmd ? { cmd: `echo ${word}` } : props.command?.type === 'array' ? { command: ['echo', word] } : { command: `echo ${word}` };
          const item = { type: 'function_call', id: 'fc_1', call_id: 'call_fake_1', name: tool.name, arguments: JSON.stringify(args), status: 'completed' };
          events.push(ev('response.output_item.added', { output_index: 0, item: { ...item, arguments: '' } }), ev('response.output_item.done', { output_index: 0, item }));
          output = [item];
        } else {
          const item = { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Hello from the fake model.', annotations: [] }] };
          events.push(ev('response.output_item.added', { output_index: 0, item: { ...item, content: [] } }), ev('response.content_part.added', { output_index: 0, content_index: 0, part: { type: 'output_text', text: '' } }), ev('response.output_text.delta', { output_index: 0, content_index: 0, delta: 'Hello from the fake model.' }), ev('response.output_item.done', { output_index: 0, item }));
          output = [item];
        }
        events.push(ev('response.completed', { response: { id, object: 'response', status: 'completed', model, output, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }));
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
        return res.end();
      }
      return send(404, { error: { message: `fake server: no route for ${req.method} ${p}`, type: 'invalid_request_error' } });
    });
  });
  server.on('connection', (s) => { s.on('error', () => {}); sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return new Promise((resolve) => server.listen(port, host, () => resolve({
    port: server.address().port, host, log,
    url: `http://${host}:${server.address().port}`,
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  })));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('fake-openai-server.mjs')) {
  const s = await startFakeServer({ port: Number(process.env.PORT ?? 0), requireKey: process.env.FAKE_KEY ?? null });
  console.log(`fake server on ${s.url}`);
}
