// @ts-nocheck
// TEMPORARY (epic 14, spike 14.1): what a tool-free structured completion needs (epic 15's manager).
// A plain fetch client (no harness, no tools, no files) asks the fake server for one JSON object
// constrained by a JSON schema, checks it itself, and walks a ladder when a server refuses:
//   1. response_format json_schema (strict)   2. response_format json_object + schema in the prompt
//   3. no response_format, schema in the prompt, tolerate a code fence
import { startFakeServer } from './fake-openai-server.mjs';

const SCHEMA = { type: 'object', additionalProperties: false, required: ['verdict', 'reason'], properties: { verdict: { enum: ['fit', 'unfit'] }, reason: { type: 'string' } } };

function validate(v, s, path = '$') {
  const errs = [];
  if (s.enum && !s.enum.includes(v)) errs.push(`${path}: not one of ${s.enum.join('|')}`);
  if (s.type === 'object') {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return [`${path}: not an object`];
    for (const k of s.required ?? []) if (!(k in v)) errs.push(`${path}.${k}: missing`);
    if (s.additionalProperties === false) for (const k of Object.keys(v)) if (!(k in (s.properties ?? {}))) errs.push(`${path}.${k}: not allowed`);
    for (const [k, sub] of Object.entries(s.properties ?? {})) if (k in v) errs.push(...validate(v[k], sub, `${path}.${k}`));
  } else if (s.type === 'string' && typeof v !== 'string') errs.push(`${path}: not a string`);
  return errs;
}
function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  try { return { value: JSON.parse(body), fenced: !!fenced }; } catch (e) { return { error: `not JSON: ${String(e.message).slice(0, 60)}` }; }
}

async function complete(base, model, mode, userText, key) {
  const body = { model, temperature: 0, max_tokens: 256, stream: false, messages: [{ role: 'system', content: 'You judge fitness. Answer with one JSON object only.' }, { role: 'user', content: userText }] };
  if (mode === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name: 'verdict', strict: true, schema: SCHEMA } };
  if (mode === 'json_object') { body.response_format = { type: 'json_object' }; body.messages[1].content += `\nSchema: ${JSON.stringify(SCHEMA)}`; }
  if (mode === 'prompt') body.messages[1].content += `\nReply with JSON matching: ${JSON.stringify(SCHEMA)}`;
  const t = Date.now();
  let res;
  try { res = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) }); } catch (e) { return { mode, failed: 'network', detail: String(e.message ?? e) }; }
  const raw = await res.text();
  if (!res.ok) return { mode, failed: `http ${res.status}`, detail: raw.slice(0, 160) };
  let msg; try { msg = JSON.parse(raw).choices?.[0]?.message?.content ?? ''; } catch { return { mode, failed: 'bad envelope' }; }
  const p = parseJson(msg);
  if (p.error) return { mode, failed: p.error, ms: Date.now() - t, content: msg.slice(0, 80) };
  const errs = validate(p.value, SCHEMA);
  return { mode, ok: errs.length === 0, errors: errs, fenced: p.fenced, ms: Date.now() - t, value: p.value };
}

async function ladder(base, model, userText, key) {
  const tried = [];
  for (const mode of ['json_schema', 'json_object', 'prompt']) {
    const r = await complete(base, model, mode, userText, key);
    tried.push(r);
    if (r.ok) return { model, usedMode: mode, tried };
  }
  return { model, usedMode: null, tried };
}

export async function runStructured(log) {
  const fake = await startFakeServer({ requireKey: 'k-structured' });
  const out = {};
  out.conforming = await ladder(fake.url, 'fake-small', 'Is this fit? MANAGER_TEST', 'k-structured');
  out.malformed = await ladder(fake.url, 'fake-small', 'Is this fit? MANAGER_TEST MALFORMED', 'k-structured');
  out.noJsonSchema = await ladder(fake.url, 'fake-nojson', 'Is this fit? MANAGER_TEST', 'k-structured');
  out.noResponseFormat = await ladder(fake.url, 'fake-noformat', 'Is this fit? MANAGER_TEST', 'k-structured');
  out.badKey = await ladder(fake.url, 'fake-small', 'Is this fit? MANAGER_TEST', 'wrong');
  out.serverReceived = fake.log.filter((e) => e.path === '/v1/chat/completions').map((e) => ({ model: e.model, responseFormat: e.responseFormat ?? 'none', stream: e.stream, tools: e.tools?.length ?? 0, toolChoice: e.toolChoice, temperature: e.temperature, maxTokens: e.maxTokens, auth: e.auth }));
  await fake.close();
  for (const [k, v] of Object.entries(out)) log(`STRUCTURED ${k}`, v);
  return out;
}
