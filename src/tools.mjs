import { validateSchema, jsonCopy, fail } from './core.mjs';
const string = { type: 'string' };
const definition = (name, description, properties = {}, required = []) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
export const TOOL_SPECS = [
  definition('routine_list', 'List saved routines and current capture/replay state. No execution.'),
  definition('routine_tools', 'List available tool contracts. WebMCP tools need routine_web_open first. Record names exactly as returned.'),
  definition('routine_record', 'Begin opt-in, task-local capture of a successful linear workflow. Inputs are exact example argument values, not a natural-language goal. Human approval is required.', { name: string, inputs_json: { ...string, description: 'JSON object of named example scalar inputs, e.g. {"category":"notes"}.' }, tools: { type: 'array', items: string } }, ['name', 'inputs_json', 'tools']),
  definition('routine_preview', 'Preview the executable routine without saving. Use checks to verify task success, not just output shape.', { checks_json: { ...string, description: 'Optional JSON array: [{"step":"step_2","path":"/opened","equals":true}] or a check with "input":"category".' } }),
  definition('routine_save', 'Show the exact routine to the user, then save only if approved. Does not replay. Never claim that shape checks prove business success.', { checks_json: string }),
  definition('routine_discard', 'Discard the current in-memory recording. Saved routines are preserved.'),
  definition('routine_inspect', 'Read one saved routine, including its inputs, origin contracts, bindings, and success checks.', { name: string }, ['name']),
  definition('routine_import', 'Review and import portable routine JSON into local storage. Requires human approval. Never overwrites an existing routine.', { routine_json: string }, ['routine_json']),
  definition('routine_run', 'Replay a reviewed routine with new input values, using live tools and existing host permissions. Requires fresh human approval; stop on mismatch. The replay engine makes no model calls.', { name: string, inputs_json: string }, ['name', 'inputs_json']),
  definition('routine_stop', 'Cancel the active replay and close only RoutineKit\'s isolated browser. Already completed side effects are not rolled back.'),
  definition('routine_web_open', 'Ask permission to open a WebMCP origin in a blank isolated browser. No existing login profile, screen-scraping fallback, or cross-origin requests.', { url: string }, ['url']),
  definition('routine_web_call', 'Execute one discovered WebMCP tool after human approval. Selected calls are captured by an active recording. Tool hints are not safety guarantees.', { name: { ...string, description: 'Exact webmcp: tool name from routine_tools.' }, arguments_json: string }, ['name', 'arguments_json']),
];
function parse(text, fallback) {
  if (text === undefined) return fallback;
  try { return jsonCopy(JSON.parse(text)); } catch { fail('JSON', 'Invalid or oversized JSON argument.'); }
}
export async function invokeTool(service, name, args, options) {
  const spec = TOOL_SPECS.find(s => s.name === name);
  if (!spec) fail('TOOL', 'Unknown RoutineKit tool.');
  validateSchema(spec.inputSchema, args);
  const actions = { routine_list: 'list', routine_tools: 'tools', routine_record: 'record', routine_preview: 'preview', routine_save: 'save', routine_discard: 'discard', routine_inspect: 'inspect', routine_import: 'import', routine_run: 'run', routine_stop: 'stop', routine_web_open: 'open', routine_web_call: 'call' };
  return service.invoke(actions[name], { ...args, inputs: parse(args.inputs_json, {}), checks: parse(args.checks_json, []), arguments: parse(args.arguments_json, {}), routine: parse(args.routine_json, undefined) }, options);
}
