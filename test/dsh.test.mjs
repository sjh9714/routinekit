import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Context, Service } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import { createScope } from '@deepseek-ai/dsh-scope';
import * as routinekit from '../src/dsh.mjs';

test('real DSH tool pipeline captures, saves, replays and retains host denial', async () => {
  const home = await mkdtemp(join(tmpdir(), 'routinekit-dsh-test-')); const before = process.env.DSH_HOME; process.env.DSH_HOME = home;
  const ctx = new Context(); const approvals = []; const invoked = [];
  new SystemPrompt(ctx, {}); new ToolRuntime(ctx);
  class Questions extends Service { constructor(ctx) { super(ctx, 'userQuestions'); } async ask(request) { approvals.push(request); return { answers: [{ id: 'routinekit-approval', selected: ['Approve once'] }] }; } }
  new Questions(ctx);
  const agent = { id: 'routinekit-test-agent', options: {}, session: { cwd: home } }; const scope = createScope(ctx, agent); agent.ctx = scope.ctx;
  const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
  for (const name of ['demo_search', 'demo_open']) ctx.tools.register({ name, description: name, parameters: object(name === 'demo_search' ? { query: { type: 'string' } } : { id: { type: 'string' } }), output: { schema: object({ id: { type: 'string' }, done: { type: 'boolean' } }), render: (_, value) => [{ type: 'text', text: JSON.stringify(value) }] }, async execute(args) { invoked.push([name,args]); return { id: args.id || `id-${args.query}`, done: true }; } });
  await ctx.plugin(routinekit);
  async function call(name, args = {}) { return ctx.tools.execute({ name, arguments: args, agent, callId: randomUUID(), signal: new AbortController().signal }); }
  try {
    let result = await call('routine_record', { name: 'dsh-flow', inputs_json: '{"query":"first"}', tools: ['dsh:demo_search','dsh:demo_open'] }); assert.equal(result.isError, false, JSON.stringify(result));
    assert.equal((await call('demo_search', { query: 'first' })).isError, false);
    assert.equal((await call('demo_open', { id: 'id-first' })).isError, false);
    result = await call('routine_save', { checks_json: '[{"step":"step_2","path":"/done","equals":true}]' }); assert.equal(result.isError, false, JSON.stringify(result));
    result = await call('routine_run', { name: 'dsh-flow', inputs_json: '{"query":"second"}' }); assert.equal(result.isError, false, JSON.stringify(result));
    const replayed = JSON.parse(result.value.json); assert.equal(replayed.result.id, 'id-second'); assert.equal(replayed.modelCalls, 0); assert.equal(invoked.length, 4); assert.equal(approvals.length, 3);
    const unguard = ctx.tools.guard(exec => exec.name === 'demo_open' ? 'test denial' : undefined);
    result = await call('routine_run', { name: 'dsh-flow', inputs_json: '{"query":"third"}' }); assert.equal(result.isError, true); assert.equal(invoked.length, 5); unguard();
    const other = { id: 'other-agent', options: {}, session: { cwd: 'other' } }; const otherScope = createScope(ctx, other); other.ctx = otherScope.ctx;
    const otherResult = await ctx.tools.execute({ name: 'routine_list', arguments: {}, agent: other, callId: randomUUID(), signal: new AbortController().signal });
    assert.equal(JSON.parse(otherResult.value.json).routines.length, 0); await otherScope.dispose();
  } finally { await scope.dispose(); await ctx.fiber.dispose(); if (before === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = before; await rm(home, { recursive: true }); }
});
