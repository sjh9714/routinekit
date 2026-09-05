import { createHash, randomUUID } from 'node:crypto';
import Ajv from 'ajv';

export const LIMITS = Object.freeze({ steps: 40, bytes: 512 * 1024, depth: 24, ttl: 15 * 60_000 });
const ajv = new Ajv({ strict: false, strictSchema: true, allErrors: false, validateFormats: false });
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const sensitiveKey = /^(?:password|passwd|passphrase|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|cookie|set-cookie|session[_-]?cookie|credit[_-]?card|card[_-]?number|cvv|otp)$/i;
const secretValue = /(?:\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b|\bBearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b)/;

export class RoutineError extends Error {
  constructor(code, message) { super(message); this.name = 'RoutineError'; this.code = code; }
}
export function fail(code, message) { throw new RoutineError(code, message); }
export function checkAbort(signal) { if (signal?.aborted) fail('CANCELLED', 'Cancelled. No further steps were started.'); }
export function safeError(error) {
  return error instanceof RoutineError ? { code: error.code, message: error.message } : { code: 'TOOL_FAILED', message: 'The operation failed. Inspect the connected tool locally; raw errors are not exported.' };
}
export function jsonCopy(value, maxBytes = LIMITS.bytes) {
  const seen = new Set();
  function visit(node, depth) {
    if (depth > LIMITS.depth) fail('LIMIT', 'JSON nesting limit exceeded.');
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return;
    if (typeof node === 'number' && Number.isFinite(node)) return;
    if (typeof node !== 'object' || seen.has(node)) fail('INVALID_JSON', 'Only finite, acyclic JSON values are accepted.');
    if (!Array.isArray(node) && Object.getPrototypeOf(node) !== Object.prototype && Object.getPrototypeOf(node) !== null) fail('INVALID_JSON', 'Only plain JSON objects are accepted.');
    seen.add(node);
    for (const [key, child] of Object.entries(node)) {
      if (forbiddenKeys.has(key)) fail('INVALID_KEY', 'Unsafe object key rejected.');
      visit(child, depth + 1);
    }
    seen.delete(node);
  }
  visit(value, 0);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > maxBytes) fail('LIMIT', 'JSON size limit exceeded.');
  return JSON.parse(text);
}
export function assertNoSecrets(value) {
  function visit(node) {
    if (typeof node === 'string') {
      if (secretValue.test(node)) fail('SENSITIVE_DATA', 'Possible credential detected. Discard this recording and use a non-sensitive task.');
      if (/^https?:\/\//i.test(node)) {
        let url;
        try { url = new URL(node); } catch { return; }
        if (url.username || url.password || [...url.searchParams.keys()].some(key => sensitiveKey.test(key))) fail('SENSITIVE_DATA', 'Credential-bearing URL rejected.');
      }
    } else if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (sensitiveKey.test(key)) fail('SENSITIVE_DATA', 'Possible credential field detected. This recording cannot be saved.');
        visit(child);
      }
    }
  }
  visit(value);
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function fingerprint(value) { return createHash('sha256').update(canonical(jsonCopy(value))).digest('hex'); }
function compileSchema(schema) {
  const copy = jsonCopy(schema);
  function noRefs(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(noRefs); return; }
    if ('$ref' in node || '$dynamicRef' in node || '$recursiveRef' in node || 'pattern' in node || 'patternProperties' in node || 'format' in node) fail('UNSUPPORTED_SCHEMA', 'Referenced, regex, and format schemas are not supported in v0.1.');
    for (const [key, child] of Object.entries(node)) {
      if (['properties', '$defs', 'definitions', 'dependencies', 'dependentSchemas'].includes(key) && child && typeof child === 'object') Object.values(child).forEach(noRefs);
      else if (['allOf','anyOf','oneOf','prefixItems'].includes(key) && Array.isArray(child)) child.forEach(noRefs);
      else if (['items','additionalItems','additionalProperties','not','if','then','else','contains','propertyNames','unevaluatedProperties','unevaluatedItems'].includes(key)) noRefs(child);
    }
  }
  noRefs(copy);
  let validate;
  try { validate = ajv.compile(copy); } catch { fail('UNSUPPORTED_SCHEMA', 'This tool schema cannot be validated.'); }
  return validate;
}
export function validateSchema(schema, value, code = 'CONTRACT') {
  const validate = compileSchema(schema);
  if (!validate(value)) fail(code, 'Value does not match the reviewed contract.');
}
export function toolContract(tool) {
  if (!tool || typeof tool.name !== 'string' || !tool.name || tool.name.length > 200) fail('TOOL', 'Invalid tool identity.');
  const contract = { name: tool.name, inputSchema: jsonCopy(tool.inputSchema), effect: tool.effect === 'read' ? 'read' : 'unknown' };
  if (tool.outputSchema) contract.outputSchema = jsonCopy(tool.outputSchema);
  if (tool.origin) {
    const url = new URL(tool.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== tool.origin) fail('ORIGIN', 'An exact HTTP(S) origin is required.');
    contract.origin = url.origin;
  }
  return contract;
}
const escapePart = key => key.replaceAll('~', '~0').replaceAll('/', '~1');
function pathParts(path) {
  if (typeof path !== 'string' || (path !== '' && !path.startsWith('/')) || path.length > 1500 || /~(?![01])/u.test(path)) fail('POINTER', 'Invalid JSON pointer.');
  const parts = path === '' ? [] : path.slice(1).split('/').map(p => p.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (parts.some(p => forbiddenKeys.has(p))) fail('POINTER', 'Unsafe JSON pointer rejected.');
  return parts;
}
export function getPath(root, path) {
  let value = root;
  for (const key of pathParts(path)) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) fail('REFERENCE', 'A referenced result field is missing.');
    value = value[key];
  }
  return value;
}
function setPath(root, path, value) {
  const parts = pathParts(path);
  if (!parts.length) return jsonCopy(value);
  const key = parts.pop();
  const parent = getPath(root, '/' + parts.map(escapePart).join('/'));
  if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) fail('REFERENCE', 'Binding target is missing.');
  parent[key] = jsonCopy(value);
  return root;
}
function replaceAt(root, path, value) {
  if (pathParts(path).length === 1) {
    const key = pathParts(path)[0];
    if (!root || typeof root !== 'object' || !Object.hasOwn(root, key)) fail('REFERENCE', 'Binding target is missing.');
    root[key] = jsonCopy(value); return root;
  }
  return setPath(root, path, value);
}
function walkLeaves(value, visit, path = '') {
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) walkLeaves(child, visit, `${path}/${escapePart(key)}`);
  } else visit(value, path);
}
export function shapeOf(value, depth = 0) {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) return { type: 'array', ...(value.length && depth < 6 ? { items: shapeOf(value[0], depth + 1) } : {}) };
  if (typeof value === 'object') {
    if (depth >= 6) return { type: 'object' };
    return { type: 'object', properties: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, shapeOf(child, depth + 1)])), required: Object.keys(value) };
  }
  return { type: typeof value };
}
function inputSchema(inputs) {
  const properties = {};
  for (const [name, value] of Object.entries(inputs)) {
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(name)) fail('INPUT', 'Input names must use lowercase letters, digits, and underscores.');
    if (!['string', 'number', 'boolean'].includes(typeof value)) fail('INPUT', 'Recording inputs must be string, number, or boolean examples.');
    properties[name] = { type: typeof value };
  }
  return { type: 'object', properties, required: Object.keys(inputs), additionalProperties: false };
}

export class Recorder {
  #recording;
  #timer;
  begin({ name, inputs = {}, tools }) {
    if (this.#recording) fail('BUSY', 'Discard or save the active recording first.');
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(name)) fail('NAME', 'Use a 2–64 character lowercase slug.');
    if (!Array.isArray(tools) || !tools.length || tools.length > LIMITS.steps) fail('TOOLS', 'Select between 1 and 40 tools explicitly.');
    const examples = jsonCopy(inputs); assertNoSecrets(examples); inputSchema(examples);
    const contracts = tools.map(toolContract);
    if (new Set(contracts.map(t => t.name)).size !== contracts.length) fail('TOOLS', 'Duplicate tool names.');
    this.#recording = { name, inputs: examples, contracts, started: Date.now(), calls: [], active: new Set(), invalid: null };
    this.#timer = setTimeout(() => this.discard(), LIMITS.ttl); this.#timer.unref?.();
    return this.status();
  }
  status() {
    const r = this.#recording;
    if (!r) return { state: 'idle' };
    if (Date.now() - r.started > LIMITS.ttl) { this.discard(); return { state: 'expired' }; }
    return { state: r.invalid ? 'invalid' : 'recording', name: r.name, steps: r.calls.length, pending: r.active.size, error: r.invalid, tools: r.contracts.map(t => t.name) };
  }
  invalidate(message = 'A selected tool failed. Discard and record a successful linear task.') {
    if (this.#recording) { this.#recording.invalid = message; this.#recording.calls = []; this.#recording.inputs = {}; }
  }
  start(name, token = randomUUID()) {
    if (this.status().state !== 'recording') return undefined;
    const r = this.#recording;
    if (!r.contracts.some(t => t.name === name)) return undefined;
    if (r.active.size) { this.invalidate('Overlapping calls cannot be replayed as a linear routine.'); return undefined; }
    r.active.add(token); return token;
  }
  finish(token, name, args, result, success = true) {
    const r = this.#recording;
    if (!r || !token || !r.active.delete(token) || r.invalid || this.status().state !== 'recording') return;
    if (!success) { this.invalidate(); return; }
    try {
      const contract = r.contracts.find(t => t.name === name);
      const argumentsCopy = jsonCopy(args); const output = jsonCopy(result);
      assertNoSecrets(argumentsCopy); assertNoSecrets(output);
      validateSchema(contract.inputSchema, argumentsCopy);
      if (contract.outputSchema) validateSchema(contract.outputSchema, output);
      if (r.calls.length >= LIMITS.steps) fail('LIMIT', 'Recording step limit exceeded.');
      r.calls.push({ contract, arguments: argumentsCopy, output });
      jsonCopy(r.calls);
    } catch (error) { this.invalidate(safeError(error).message); }
  }
  draft(checks = []) {
    if (this.status().state !== 'recording') fail('RECORDING', 'A valid active recording is required.');
    const r = this.#recording;
    if (!r.calls.length || r.active.size) fail('RECORDING', 'Finish at least one successful call before saving.');
    checks = jsonCopy(checks);
    if (!Array.isArray(checks) || checks.some(c => !c || typeof c !== 'object' || !/^step_[1-9][0-9]*$/.test(c.step) || Number(c.step.slice(5)) > r.calls.length)) fail('CHECK', 'Success checks must target a recorded step.');
    const prior = [];
    const steps = r.calls.map((call, i) => {
      let args = jsonCopy(call.arguments); const bindings = [];
      walkLeaves(call.arguments, (value, at) => {
        // Deliberately do not guess substrings or ambiguous data flow.
        const inputs = Object.entries(r.inputs).filter(([, v]) => Object.is(v, value));
        const refs = prior.filter(ref => Object.is(ref.value, value) && ((typeof value === 'string' && value.length >= 3) || (typeof value === 'number' && value !== 0 && value !== 1)));
        if (inputs.length === 1) bindings.push({ at, input: inputs[0][0] });
        else if (inputs.length === 0 && refs.length === 1) bindings.push({ at, from: refs[0].step, path: refs[0].path });
      });
      for (const binding of bindings) args = replaceAt(args, binding.at, null);
      const id = `step_${i + 1}`;
      walkLeaves(call.output, (value, path) => prior.push({ value, path, step: id }));
      return { id, tool: call.contract.name, contract: call.contract, contractHash: fingerprint(call.contract), arguments: args, bindings, expect: shapeOf(call.output), checks: checks.filter(check => check.step === id).map(({ step, ...check }) => check) };
    });
    const draft = { format: 'routinekit/v1', name: r.name, inputs: inputSchema(r.inputs), steps };
    validateRoutine(draft);
    for (let i = 0; i < steps.length; i++) verifyOutput(steps[i], r.calls[i].output, r.inputs);
    // Every named input must be actually used; otherwise the UI would promise a parameter that changes nothing.
    for (const key of Object.keys(r.inputs)) if (!steps.some(s => s.bindings.some(b => b.input === key))) fail('UNUSED_INPUT', 'One example input does not exactly match any recorded argument. Choose a direct argument value.');
    return draft;
  }
  discard() { clearTimeout(this.#timer); this.#timer = undefined; this.#recording = undefined; }
}

export function validateRoutine(value) {
  const r = jsonCopy(value); assertNoSecrets(r);
  const only = (object, keys) => { if (Object.keys(object).some(k => !keys.includes(k))) fail('FORMAT', 'Unexpected routine field.'); };
  only(r, ['format','name','inputs','steps']);
  if (r.format !== 'routinekit/v1' || !/^[a-z][a-z0-9-]{1,63}$/.test(r.name)) fail('FORMAT', 'Unsupported routine format or invalid name.');
  if (!r.inputs || r.inputs.type !== 'object' || r.inputs.additionalProperties !== false || !r.inputs.properties || !Array.isArray(r.inputs.required)) fail('INPUT', 'Routine must declare exact named inputs.');
  for (const key of Object.keys(r.inputs.properties)) if (!/^[a-z][a-z0-9_]{0,47}$/.test(key) || !['string','number','boolean'].includes(r.inputs.properties[key]?.type)) fail('INPUT', 'Invalid scalar input declaration.');
  if (canonical([...r.inputs.required].sort()) !== canonical(Object.keys(r.inputs.properties).sort())) fail('INPUT', 'Every named input must be required exactly once.');
  compileSchema(r.inputs);
  if (!Array.isArray(r.steps) || !r.steps.length || r.steps.length > LIMITS.steps) fail('STEPS', 'A routine needs 1–40 steps.');
  const seen = new Set();
  for (const step of r.steps) {
    only(step, ['id','tool','contract','contractHash','arguments','bindings','expect','checks']);
    if (!/^step_[1-9][0-9]*$/.test(step.id) || seen.has(step.id)) fail('STEP', 'Invalid or duplicate step id.');
    if (step.tool !== step.contract?.name || fingerprint(toolContract(step.contract)) !== step.contractHash) fail('CONTRACT', 'Invalid contract fingerprint.');
    only(step.contract, ['name','inputSchema','outputSchema','origin','effect']);
    compileSchema(step.contract.inputSchema);
    if (step.contract.outputSchema) compileSchema(step.contract.outputSchema);
    if (!Array.isArray(step.bindings) || step.bindings.length > 1000) fail('BINDINGS', 'Invalid bindings.');
    const targets = [];
    for (const binding of step.bindings) {
      pathParts(binding.at); getPath(step.arguments, binding.at);
      if (targets.some(t => t === binding.at || t === '' || binding.at === '' || t.startsWith(binding.at + '/') || binding.at.startsWith(t + '/'))) fail('BINDINGS', 'Overlapping bindings are not allowed.');
      targets.push(binding.at);
      if ('input' in binding) {
        only(binding, ['at','input']);
        if ('from' in binding || !Object.hasOwn(r.inputs.properties, binding.input)) fail('BINDINGS', 'Unknown or ambiguous input binding.');
      } else if (!seen.has(binding.from)) fail('BINDINGS', 'Only earlier results can be referenced.');
      else { only(binding, ['at','from','path']); pathParts(binding.path); }
    }
    if (!step.expect || typeof step.expect !== 'object') fail('CHECK', 'Every step needs an output contract.');
    compileSchema(step.expect);
    if (!Array.isArray(step.checks) || step.checks.length > 40) fail('CHECK', 'Invalid output checks.');
    for (const check of step.checks) {
      only(check, ['path','equals','input']);
      pathParts(check.path);
      if (('equals' in check) === ('input' in check)) fail('CHECK', 'A check must compare with one literal or input.');
      if ('input' in check && !Object.hasOwn(r.inputs.properties, check.input)) fail('CHECK', 'Unknown check input.');
    }
    seen.add(step.id);
  }
  return r;
}
function verifyOutput(step, value, inputs) {
  validateSchema(step.expect, value, 'OUTPUT_CHANGED');
  for (const check of step.checks) {
    const expected = 'input' in check ? inputs[check.input] : check.equals;
    if (canonical(getPath(value, check.path)) !== canonical(expected)) fail('CHECK_FAILED', 'A reviewed success check failed. The routine stopped.');
  }
}

export async function replay(routine, inputs, adapter, { signal, approve, onEvent = () => {} } = {}) {
  const r = validateRoutine(routine); const params = jsonCopy(inputs); assertNoSecrets(params);
  validateSchema(r.inputs, params, 'INPUT'); checkAbort(signal);
  async function preflight() {
    for (const step of r.steps) {
      checkAbort(signal);
      const current = await adapter.describe(step.tool, step.contract);
      if (!current || fingerprint(toolContract(current)) !== step.contractHash) fail('TOOL_CHANGED', 'A required tool, origin, or schema changed. Nothing further will run.');
    }
  }
  await preflight();
  if (!approve || !await approve({ stage: 'run', routine: jsonCopy(r), inputs: jsonCopy(params) }, signal)) fail('APPROVAL_REQUIRED', 'Review and approve this run before executing any step.');
  checkAbort(signal); await preflight();
  const outputs = new Map();
  for (const step of r.steps) {
    checkAbort(signal);
    let args = jsonCopy(step.arguments);
    for (const binding of step.bindings) args = replaceAt(args, binding.at, 'input' in binding ? params[binding.input] : getPath(outputs.get(binding.from), binding.path));
    validateSchema(step.contract.inputSchema, args, 'INPUT'); assertNoSecrets(args);
    if (adapter.approveEachCall && !await approve({ stage: 'step', routine: jsonCopy(r), step: jsonCopy(step), arguments: jsonCopy(args) }, signal)) fail('APPROVAL_REQUIRED', 'This tool call was not approved.');
    checkAbort(signal);
    const current = await adapter.describe(step.tool, step.contract);
    if (!current || fingerprint(toolContract(current)) !== step.contractHash) fail('TOOL_CHANGED', 'Tool changed immediately before dispatch.');
    onEvent({ type: 'step', id: step.id, tool: step.tool, status: 'running' });
    let result;
    try { result = jsonCopy(await adapter.call(step.tool, args, { signal, contract: step.contract })); }
    catch (error) { checkAbort(signal); throw error instanceof RoutineError ? error : new RoutineError('TOOL_FAILED', 'A tool failed. No further steps were started; earlier actions are not rolled back.'); }
    checkAbort(signal); assertNoSecrets(result);
    if (step.contract.outputSchema) validateSchema(step.contract.outputSchema, result, 'OUTPUT_CHANGED');
    verifyOutput(step, result, params); outputs.set(step.id, result);
    onEvent({ type: 'step', id: step.id, tool: step.tool, status: 'complete' });
  }
  return { status: 'complete', steps: r.steps.length, modelCalls: 0, result: outputs.get(r.steps.at(-1).id) };
}
