import { Recorder, replay, fail, checkAbort, jsonCopy, validateRoutine, safeError, assertNoSecrets } from './core.mjs';
import { RoutineStore } from './store.mjs';
import { WebMCPBrowser } from './browser.mjs';

export class RoutineService {
  constructor({ root, browser, nativeTools = async () => [] } = {}) {
    this.recorder = new Recorder(); this.store = new RoutineStore(root);
    this.browser = browser || new WebMCPBrowser(); this.nativeTools = nativeTools;
    this.events = []; this.runState = 'idle';
  }
  async tools() {
    const web = this.browser.page ? (await this.browser.list()).map(t => ({ ...t, name: `webmcp:${t.name}` })) : [];
    return [...web, ...await this.nativeTools()];
  }
  async describe(name) { return (await this.tools()).find(t => t.name === name); }
  async state() {
    return { recording: this.recorder.status(), routines: await this.store.list(), browser: this.browser.page ? { origin: this.browser.origin, mode: this.browser.mode } : null, run: this.runState, events: this.events.slice(-40), lastResult: this.lastResult || null };
  }
  async requestApproval(approve, request, signal) {
    checkAbort(signal);
    if (!approve || !await approve(jsonCopy(request))) fail('APPROVAL_REQUIRED', 'Human review is required for this action.');
    checkAbort(signal);
  }
  async invoke(action, args = {}, { approve, signal, nativeCall } = {}) {
    if (action === 'list') return this.state();
    if (action === 'tools') return { tools: await this.tools() };
    if (action === 'inspect') return this.store.get(args.name);
    if (action === 'preview') return this.recorder.draft(args.checks || []);
    if (action === 'stop') { this.controller?.abort(); await this.browser.close(); return { status: 'stopped' }; }
    if (this.busy) fail('BUSY', 'Another operation is still active.');
    this.busy = true;
    try {
      if (action === 'open') {
        if (this.recorder.status().state === 'recording') fail('RECORDING', 'Finish or discard recording before changing pages.');
        assertNoSecrets(args.url);
        await this.requestApproval(approve, { stage: 'open', url: args.url, note: 'Open this origin in an empty browser. Cross-origin requests, downloads, popups and existing profiles are not supported.' }, signal);
        return await this.browser.open(args.url);
      }
      if (action === 'record') {
        const tools = await this.tools();
        if (!Array.isArray(args.tools) || !args.tools.length) fail('TOOLS', 'Choose tools to record.');
        const selected = args.tools.map(name => tools.find(t => t.name === name));
        if (selected.some(t => !t)) fail('TOOL_MISSING', 'A selected tool is unavailable.');
        const params = jsonCopy(args.inputs || {}); assertNoSecrets(params);
        await this.requestApproval(approve, { stage: 'record', name: args.name, tools: args.tools, inputs: params, note: 'Only these tools are captured for this task, in memory, for at most 15 minutes. Raw outputs are not saved by RoutineKit. The host may have its own logs.' }, signal);
        return this.recorder.begin({ ...args, inputs: params, tools: selected });
      }
      if (action === 'discard') { this.recorder.discard(); return { status: 'discarded' }; }
      if (action === 'call') {
        if (!args.name?.startsWith('webmcp:')) fail('TOOL', 'Direct calls are limited to WebMCP. Use the DSH host for native tools.');
        const tool = await this.describe(args.name); if (!tool) fail('TOOL_MISSING', 'Open the required WebMCP page first.');
        const params = jsonCopy(args.arguments || {}); assertNoSecrets(params);
        await this.requestApproval(approve, { stage: 'call', tool: args.name, origin: tool.origin, arguments: params, note: 'Tool descriptions and read-only hints are not a security guarantee. This call may change state on the approved origin.' }, signal);
        const token = this.recorder.start(args.name);
        try {
          const result = await this.browser.call(args.name.slice(7), params, { signal, contract: tool });
          this.recorder.finish(token, args.name, params, result); return result;
        } catch (error) { this.recorder.finish(token, args.name, params, null, false); throw error; }
      }
      if (action === 'save' || action === 'import') {
        const routine = action === 'save' ? this.recorder.draft(args.checks || []) : validateRoutine(args.routine);
        await this.requestApproval(approve, { stage: action, routine, note: 'Review every literal and binding. Credential detection is heuristic: private business data can remain in literal arguments. Save does not execute the routine.' }, signal);
        const result = await this.store.save(routine);
        if (action === 'save') this.recorder.discard();
        return result;
      }
      if (action === 'run') {
        if (this.recorder.status().state !== 'idle' && this.recorder.status().state !== 'expired') fail('RECORDING', 'Save or discard recording before replay.');
        const routine = await this.store.get(args.name);
        this.events = []; this.lastResult = null; this.runState = 'running'; this.controller = new AbortController();
        const fused = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal;
        const adapter = {
          approveEachCall: routine.steps.some(s => s.tool.startsWith('webmcp:')),
          describe: name => this.describe(name),
          call: (name, arguments_, options) => {
            if (name.startsWith('webmcp:')) return this.browser.call(name.slice(7), arguments_, options);
            if (!nativeCall) fail('HOST_REQUIRED', 'This routine uses DSH-native tools. Run it through routine_run in the original host.');
            return nativeCall(name, arguments_, options);
          },
        };
        try {
          const result = await replay(routine, args.inputs || {}, adapter, { signal: fused, approve, onEvent: event => this.events.push(event) });
          this.runState = 'complete'; this.lastResult = result; return result;
        } catch (error) { this.runState = fused.aborted ? 'cancelled' : 'failed'; this.lastResult = { status: this.runState, error: safeError(error) }; throw error; }
        finally { this.controller = undefined; }
      }
      fail('ACTION', 'Unknown action.');
    } finally { this.busy = false; }
  }
  async close() { this.controller?.abort(); this.recorder.discard(); this.lastResult = null; await this.browser.close(); }
}
