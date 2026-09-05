import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { RoutineService } from './service.mjs';
import { TOOL_SPECS, invokeTool } from './tools.mjs';
import { fail, fingerprint, safeError } from './core.mjs';
import { createHandler, ApprovalQueue } from './server.mjs';

export const name = 'routinekit';
export const inject = ['tools', 'userQuestions'];

export function apply(ctx) {
  const owners = new Map(); const inFlight = new Map();
  function instance(agent) {
    if (!agent?.id) fail('AGENT_REQUIRED', 'RoutineKit requires a live owning DSH task.');
    const existing = owners.get(agent.id);
    if (existing && existing.agent === agent) return existing;
    if (existing) { existing.approvals.close(); void existing.service.close(); owners.delete(agent.id); }
    const root = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'routinekit', fingerprint(agent.session?.cwd || agent.options?.cwd || agent.id).slice(0,24));
    const nativeTools = async () => ctx.tools.schemas(agent).filter(t => !t.name.startsWith('routine_') && t.name !== 'run_code').map(t => {
      const def = ctx.tools.get(t.name, agent);
      return { name: `dsh:${t.name}`, description: t.description, inputSchema: t.parameters, ...(def?.output?.schema ? { outputSchema: def.output.schema } : {}), effect: 'unknown' };
    });
    const service = new RoutineService({ root, nativeTools }); const approvals = new ApprovalQueue();
    const record = { agent, service, approvals };
    record.handler = createHandler({ prefix: '/routinekit', resolveService: () => service, authorize: req => req.headers['x-dsh-session-id'] === agent.id, approvals, dsh: true });
    owners.set(agent.id, record);
    agent.ctx?.effect(() => () => { if (owners.get(agent.id) === record) owners.delete(agent.id); approvals.close(); void service.close(); }, 'routinekit: discard task-local capture and close browser');
    return record;
  }
  async function approve(agent, signal, request) {
    const answer = await ctx.userQuestions.ask({ agent, signal, questions: [{ id: 'routinekit-approval', header: 'RoutineKit', question: `Approve once: ${request.stage}?`, detail: JSON.stringify(request, null, 2), options: [{ label: 'Deny', description: 'Do not perform this action.' }, { label: 'Approve once', description: 'Approve only the exact action shown. Existing DSH tool permissions still apply.' }] }] });
    return answer.answers.some(a => a.id === 'routinekit-approval' && a.selected.includes('Approve once'));
  }
  // Creating a task prepares an empty workbench; it does not enable capture or execute tools.
  ctx.on('agent/created', ({ agent }) => { instance(agent); });
  for (const spec of TOOL_SPECS) ctx.tools.register({
    name: spec.name, description: spec.description, parameters: spec.inputSchema, timeoutMs: 15 * 60_000,
    output: { schema: { type: 'object', properties: { json: { type: 'string' } }, required: ['json'], additionalProperties: false }, render: (_args, value) => [{ type: 'text', text: value.json }] },
    async execute(args, exec) {
      const { service } = instance(exec.agent);
      const nativeCall = async (name, arguments_, { signal }) => {
        if (!name.startsWith('dsh:')) fail('HOST_TOOL', 'Unsupported native tool namespace.');
        const result = await ctx.tools.execute({ callId: randomUUID(), rootCallId: exec.rootCallId, parent: exec.token, name: name.slice(4), arguments: arguments_, agent: exec.agent, signal });
        for (const context of result.additionalContexts || []) exec.deferContext(context);
        if (result.isError) fail('HOST_TOOL_FAILED', 'DSH rejected or failed a recorded tool. No further steps were started.');
        if (result.concludesTurn) exec.concludeTurn();
        return result.value;
      };
      try { return { json: JSON.stringify(await invokeTool(service, spec.name, args, { signal: exec.signal, approve: (request, signal) => approve(exec.agent, signal, request), nativeCall })) }; }
      catch (error) { const safe = safeError(error); throw new Error(`${safe.code}: ${safe.message}`); }
    },
  });
  ctx.on('tools/execute', async (exec, next) => {
    const owner = exec.agent && owners.get(exec.agent.id);
    if (owner?.agent === exec.agent && !exec.name.startsWith('routine_') && exec.name !== 'run_code') {
      const token = owner.service.recorder.start(`dsh:${exec.name}`, exec.token);
      if (token) inFlight.set(exec.token, { owner, name: `dsh:${exec.name}` });
    }
    return next();
  });
  ctx.on('tools/result', (exec, result) => {
    const pending = inFlight.get(exec.token);
    if (pending) { inFlight.delete(exec.token); pending.owner.service.recorder.finish(exec.token, pending.name, exec.arguments, result.value, !result.isError); }
    if (exec.name === 'run_code' && result.isError && exec.agent) owners.get(exec.agent.id)?.service.recorder.invalidate('The enclosing DSH code execution failed. Record a successful task before saving.');
  });
  ctx.inject(['webServer'], scope => {
    const empty = createHandler({ prefix: '/routinekit', resolveService: () => undefined, authorize: () => true, dsh: true });
    scope.effect(() => scope.webServer.register({ kind: 'prefix', path: '/routinekit', handler: (req, res) => {
      const owner = owners.get(req.headers['x-dsh-session-id']);
      return (owner?.handler || empty)(req, res);
    } }), 'routinekit: local workbench routes');
  });
  ctx.effect(() => () => {
    for (const record of owners.values()) { record.approvals.close(); void record.service.close(); }
    owners.clear(); inFlight.clear();
  }, 'routinekit: plugin disposal');
}
