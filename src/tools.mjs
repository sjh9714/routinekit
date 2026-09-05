import { validateSchema, jsonCopy, fail } from './core.mjs';
import { skillBundle } from './store.mjs';
const string = { type: 'string' };
const definition = (name, description, properties = {}, required = []) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
export const TOOL_SPECS = [
  definition('routine_list', 'List saved routines and current capture/replay state. No execution.'),
  definition('routine_tools', 'List available tool contracts. WebMCP tools need routine_web_open first. Record names exactly as returned.'),
  definition('routine_record', 'Begin opt-in, task-local capture of a successful linear workflow. Inputs are exact example argument values, not a natural-language goal. Human approval is required.', { name: string, inputs_json: { ...string, description: 'JSON object of named example scalar inputs, e.g. {"category":"notes"}.' }, tools: { type: 'array', items: string } }, ['name', 'inputs_json', 'tools']),
  definition('routine_preview', 'Preview the executable routine without saving. Use checks to verify task success, not just output shape.', { checks_json: { ...string, description: 'Optional JSON array: [{"step":"step_2","path":"/opened","equals":true}] or a check with "input":"category".' } }),
  definition('routine_save', 'Show the exact routine to the user, then save only if approved. Set expose to make this a named tool with typed inputs. Does not replay.', { checks_json: string, expose: { type: 'boolean' } }),
  definition('routine_discard', 'Discard the current in-memory recording. Saved routines are preserved.'),
  definition('routine_inspect', 'Read one saved routine, including its inputs, origin contracts, bindings, and success checks.', { name: string }, ['name']),
  definition('routine_import', 'Review and import portable routine JSON into local storage. Requires human approval. Never overwrites an existing routine.', { routine_json: string }, ['routine_json']),
  definition('routine_run', 'Replay a reviewed routine with new input values, using live tools and existing host permissions. Requires fresh human approval; stop on mismatch. The replay engine makes no model calls.', { name: string, inputs_json: string }, ['name', 'inputs_json']),
  definition('routine_stop', 'Cancel the active replay and close only RoutineKit\'s isolated browser. Already completed side effects are not rolled back.'),
  definition('routine_web_open', 'Ask permission to open a WebMCP origin in a blank isolated browser. No existing login profile, screen-scraping fallback, or cross-origin requests.', { url: string }, ['url']),
  definition('routine_web_call', 'Execute one discovered WebMCP tool after human approval. Selected calls are captured by an active recording. Tool hints are not safety guarantees.', { name: { ...string, description: 'Exact webmcp: tool name from routine_tools.' }, arguments_json: string }, ['name', 'arguments_json']),
  definition('routine_mcp_connect', 'Review and start one explicitly configured local MCP server. No automatic software installation, existing host configuration import, or credential transfer.', { server: string }, ['server']),
  definition('routine_mcp_call', 'Call one allowlisted connected MCP tool with human approval. Selected successful calls are recorded.', { name: { ...string, description: 'Exact mcp:alias:tool name from routine_tools.' }, arguments_json: string }, ['name', 'arguments_json']),
  definition('routine_export', 'Export one saved routine as a ZIP containing SKILL.md and routine.json. Recheck private literals before sharing. No credentials or permissions are bundled.', { name: string }, ['name']),
];
export async function savedTools(service) {
  return (await service.store.list()).filter(r => r.toolName).map(r => ({ name: r.toolName, description: `Replay saved routine ${r.name}: ${r.steps} reviewed steps. Requires live matching tools and fresh human approval. No fallback on failure.`, inputSchema: r.inputs }));
}
function parse(text, fallback) {
  if (text === undefined) return fallback;
  try { return jsonCopy(JSON.parse(text)); } catch { fail('JSON', 'Invalid or oversized JSON argument.'); }
}
export async function invokeTool(service, name, args, options) {
  const spec = TOOL_SPECS.find(s => s.name === name);
  if (!spec) {
    const routine = (await service.store.list()).find(r => r.toolName === name);
    if (!routine) fail('TOOL', 'Unknown RoutineKit tool.');
    validateSchema(routine.inputs, args);
    return service.invoke('run', { name: routine.name, inputs: args }, options);
  }
  validateSchema(spec.inputSchema, args);
  if (name === 'routine_export') return { name: `${args.name}.zip`, base64: Buffer.from(skillBundle(await service.store.get(args.name))).toString('base64') };
  const actions = { routine_list: 'list', routine_tools: 'tools', routine_record: 'record', routine_preview: 'preview', routine_save: 'save', routine_discard: 'discard', routine_inspect: 'inspect', routine_import: 'import', routine_run: 'run', routine_stop: 'stop', routine_web_open: 'open', routine_web_call: 'call', routine_mcp_connect: 'connect', routine_mcp_call: 'call' };
  if (name === 'routine_mcp_call' && !args.name.startsWith('mcp:') || name === 'routine_web_call' && !args.name.startsWith('webmcp:')) fail('TOOL', 'Use the matching namespace-specific call tool.');
  return service.invoke(actions[name], { ...args, inputs: parse(args.inputs_json, {}), checks: parse(args.checks_json, []), arguments: parse(args.arguments_json, {}), routine: parse(args.routine_json, undefined) }, options);
}
