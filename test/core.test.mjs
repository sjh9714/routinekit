import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Recorder, replay, fingerprint, validateRoutine, validateSchema, jsonCopy, assertNoSecrets, getPath, LIMITS } from '../src/core.mjs';

const search = { name: 'search', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }, effect: 'read' };
const open = { name: 'open', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }, effect: 'read' };
function recording() {
  const r = new Recorder(); r.begin({ name: 'find-project', inputs: { query: 'notes' }, tools: [search, open] });
  r.finish(r.start('search'), 'search', { query: 'notes' }, { items: [{ id: 'project-pine' }] });
  r.finish(r.start('open'), 'open', { id: 'project-pine' }, { opened: true, id: 'project-pine' });
  return r;
}
function adapter() {
  const calls = [];
  return { calls, async describe(name) { return [search, open].find(t => t.name === name); }, async call(name, args) { calls.push([name, args]); return name === 'search' ? { items: [{ id: `project-${args.query}` }] } : { opened: true, id: args.id }; } };
}
test('captures successful calls; parameters and result references replay changed inputs', async () => {
  const r = recording().draft([{ step: 'step_2', path: '/opened', equals: true }]);
  assert.equal(JSON.stringify(r).includes('project-pine'), false);
  assert.equal(JSON.stringify(r).includes('notes'), false);
  assert.deepEqual(r.steps[1].bindings, [{ at: '/id', from: 'step_1', path: '/items/0/id' }]);
  const a = adapter(); const result = await replay(r, { query: 'timer' }, a, { approve: async () => true });
  assert.equal(result.result.id, 'project-timer'); assert.equal(result.modelCalls, 0); assert.equal(a.calls.length, 2);
});
test('denied approval executes nothing', async () => {
  const a = adapter(); await assert.rejects(replay(recording().draft(), { query: 'timer' }, a, { approve: async () => false }), { code: 'APPROVAL_REQUIRED' }); assert.equal(a.calls.length, 0);
});
test('later tool schema change is caught before the first call', async () => {
  const a = adapter(); a.describe = async name => name === 'open' ? { ...open, inputSchema: { type: 'object' } } : search;
  await assert.rejects(replay(recording().draft(), { query: 'x' }, a, { approve: async () => true }), { code: 'TOOL_CHANGED' }); assert.equal(a.calls.length, 0);
});
test('schema change while approval waits is checked again', async () => {
  const a = adapter(); await assert.rejects(replay(recording().draft(), { query: 'x' }, a, { approve: async () => { a.describe = async () => undefined; return true; } }), { code: 'TOOL_CHANGED' }); assert.equal(a.calls.length, 0);
});
test('missing output field stops before a dependent call', async () => {
  const a = adapter(); a.call = async (...args) => { a.calls.push(args); return { other: [] }; };
  await assert.rejects(replay(recording().draft(), { query: 'x' }, a, { approve: async () => true }), { code: 'OUTPUT_CHANGED' }); assert.equal(a.calls.length, 1);
});
test('semantic success checks reject a shape-correct failure', async () => {
  const a = adapter(); a.call = async (name, args) => name === 'search' ? { items: [{ id: 'new-id' }] } : { opened: false, id: args.id };
  await assert.rejects(replay(recording().draft([{ step: 'step_2', path: '/opened', equals: true }]), { query: 'x' }, a, { approve: async () => true }), { code: 'CHECK_FAILED' });
});
test('failed and overlapping recordings cannot be saved', () => {
  const r = recording(); r.finish(r.start('open'), 'open', {}, undefined, false); assert.equal(r.status().state, 'invalid'); assert.throws(() => r.draft());
  r.discard(); r.begin({ name: 'parallel-test', tools: [search, open] }); r.start('search'); r.start('open'); assert.equal(r.status().state, 'invalid');
});
test('unused input and ambiguous values do not pretend to generalize', () => {
  const r = new Recorder(); r.begin({ name: 'unused-test', inputs: { value: 'missing' }, tools: [search] }); r.finish(r.start('search'), 'search', { query: 'notes' }, {}); assert.throws(() => r.draft(), { code: 'UNUSED_INPUT' });
});
test('credentials, prototype keys, cycles and oversized values are rejected', () => {
  for (const v of [{ apiKey: 'x' }, { x: 'Bearer secret' }, { x: 'https://user:pass@example.com' }]) assert.throws(() => assertNoSecrets(v), { code: 'SENSITIVE_DATA' });
  assert.throws(() => jsonCopy(JSON.parse('{"__proto__":{}}')), { code: 'INVALID_KEY' });
  const cycle = {}; cycle.self = cycle; assert.throws(() => jsonCopy(cycle), { code: 'INVALID_JSON' });
  assert.throws(() => jsonCopy('x'.repeat(600000)), { code: 'LIMIT' });
});
test('sensitive result invalidates capture without exporting raw data', () => {
  const r = recording(); r.finish(r.start('open'), 'open', { id: 'abc' }, { token: 'do-not-store' }); assert.equal(r.status().state, 'invalid'); assert.equal(JSON.stringify(r.status()).includes('do-not-store'), false);
});
test('import rejects forward references and prototype pointers', () => {
  const r = recording().draft(); r.steps[0].bindings = [{ at: '/query', from: 'step_2', path: '/id' }]; assert.throws(() => validateRoutine(r), { code: 'BINDINGS' });
  assert.throws(() => getPath({}, '/__proto__/x'), { code: 'POINTER' });
});
test('fingerprints ignore JSON key ordering, not schema changes', () => { assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 })); assert.notEqual(fingerprint(search), fingerprint(open)); });
test('cancellation during a step prevents the next step', async () => {
  const controller = new AbortController(); const a = adapter(); a.call = async (...args) => { a.calls.push(args); controller.abort(); return { items: [{ id: 'new-id' }] }; };
  await assert.rejects(replay(recording().draft(), { query: 'x' }, a, { signal: controller.signal, approve: async () => true }), { code: 'CANCELLED' }); assert.equal(a.calls.length, 1);
});
test('run approval cannot mutate the reviewed plan', async () => {
  const a = adapter(); await replay(recording().draft(), { query: 'x' }, a, { approve: async request => { request.routine.steps[0].tool = 'evil'; request.inputs.query = 'evil'; return true; } }); assert.equal(a.calls[0][0], 'search'); assert.equal(a.calls[0][1].query, 'x');
});

test('schema keywords are checked without confusing ordinary property names', () => {
  validateSchema({ type: 'object', properties: { format: { type: 'string' } }, required: ['format'] }, { format: 'png' });
  for (const schema of [
    { type: 'array', items: [{ type: 'string', pattern: 'a+' }] },
    { type: 'object', dependencies: { value: { properties: { value: { type: 'string', format: 'email' } } } } },
    { type: 'array', minContains: 2 },
  ]) assert.throws(() => validateSchema(schema, []), { code: 'UNSUPPORTED_SCHEMA' });
});

test('capture expires without status polling and late results cannot revive it', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const recorder = recording(); const token = recorder.start('open');
  t.mock.timers.tick(LIMITS.ttl);
  recorder.finish(token, 'open', { id: 'late-id' }, { opened: true });
  assert.equal(recorder.status().state, 'idle');
  assert.throws(() => recorder.draft(), { code: 'RECORDING' });
});
