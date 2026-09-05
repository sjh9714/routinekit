import { inputRow, exampleInputs, argumentFields, argumentsValue, checkRow, checksValue } from './forms.js';
const $ = id => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
const base = location.pathname.replace(/\/$/, '');
const headers = { 'content-type': 'application/json', 'x-routinekit-token': fragment.get('token') || '', 'x-dsh-session-id': fragment.get('session') || '' };
let state, routineKey, toolKey, approvalsKey, serverKey, discovered = [], refreshing = false;
function notice(message, error = false) { $('notice').hidden = false; $('notice').textContent = message; $('notice').className = error ? 'error' : ''; }
async function api(path, value) {
  if (window.routinekitAPI) return window.routinekitAPI(path, value);
  const response = await fetch(`${base}/api/${path}`, { headers, ...(value === undefined ? {} : { method: 'POST', body: JSON.stringify(value) }) });
  const data = await response.json();
  if (!response.ok) { if (data.code === 'SESSION_REQUIRED') $('initialize').hidden = false; throw Object.assign(new Error(data.error || 'Request failed'), { code: data.code }); }
  return data;
}
function element(tag, text, cls) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; }
function parse(id) { return JSON.parse($(id).value); }
function parentAction(action, args = {}) { parent.postMessage({ type: 'routinekit', action, session: fragment.get('session'), args }, location.origin); }
async function action(name, args = {}) {
  notice('Working… If approval is needed, review the card below.');
  try {
    const result = await api('action', { action: name, args });
    if (name === 'record' || name === 'discard') { $('check-rows').replaceChildren(); $('bindings').replaceChildren(); $('checks').value = '[]'; }
    $('data').textContent = JSON.stringify(result, null, 2);
    if (name === 'preview') {
      $('output').open = true;
      $('bindings').replaceChildren(...result.steps.map(step => element('p', `${step.id} · ${step.tool}\n${step.bindings.map(b => `${b.at} ← ${b.input ? `input ${b.input}` : `${b.from}${b.path}`}`).join('\n') || 'Only literal arguments — inspect before sharing.'}`)));
    }
    notice(name === 'run' ? 'Replay complete. Review the result and your success checks.' : 'Done.');
    await refresh(); return result;
  } catch (error) { notice(error.message, true); }
}
function inputValues(card, routine) {
  return Object.fromEntries(Object.entries(routine.inputs.properties).map(([name, spec]) => {
    const field = card.querySelector(`[data-input="${name}"]`); let value = field.value;
    if (spec.type === 'number') { if (!value.trim()) throw new Error(`Enter ${name}`); value = Number(value); if (!Number.isFinite(value)) throw new Error(`Invalid number: ${name}`); }
    if (spec.type === 'boolean') value = value === 'true';
    return [name, value];
  }));
}
function download(name, bytes) { const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' })); const a = element('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function renderRoutines(routines) {
  const key = JSON.stringify(routines); if (key === routineKey) return; routineKey = key;
  $('routines').replaceChildren(); $('count').textContent = `${routines.length} saved`;
  if (!routines.length) $('routines').append(element('p', 'A task you already completed can become the next tool you reach for. Start a capture, or try “routinekit demo”.', 'empty'));
  for (const routine of routines) {
    const card = element('article', undefined, 'routine'); card.append(element('h3', routine.name), element('p', `${routine.steps} steps · live contract checks`));
    if (routine.toolName) card.append(element('code', routine.toolName));
    for (const [name, spec] of Object.entries(routine.inputs.properties)) {
      const label = element('label', name); const input = element(spec.type === 'boolean' ? 'select' : 'input'); input.dataset.input = name;
      if (spec.type === 'boolean') for (const value of ['true', 'false']) { const o = element('option', value); o.value = value; input.append(o); }
      else { input.type = spec.type === 'number' ? 'number' : 'text'; input.placeholder = name; if (spec.type === 'number') input.step = 'any'; }
      label.append(input); card.append(label);
    }
    const row = element('div', undefined, 'actions'); const native = state.dsh && routine.tools.some(name => name.startsWith('dsh:'));
    const run = element('button', native ? 'Run in DSH →' : 'Review & run →');
    run.onclick = () => { try { const args = { name: routine.name, inputs: inputValues(card, routine) }; if (native) { parentAction('run', args); notice('Requested routine_run in DSH. Review the host approval prompt.'); } else void action('run', args); } catch(e) { notice(e.message, true); } };
    const inspect = element('button', 'Inspect', 'secondary'); inspect.onclick = async () => { try { $('data').textContent = JSON.stringify(await api(`routine?name=${encodeURIComponent(routine.name)}`), null, 2); $('output').open = true; } catch(e) { notice(e.message,true); } };
    const share = element('button', 'Export skill ZIP', 'quiet'); share.onclick = async () => { try { const bundle = await api(`bundle?name=${encodeURIComponent(routine.name)}`); download(bundle.name, Uint8Array.from(atob(bundle.base64), c => c.charCodeAt(0))); notice('Downloaded SKILL.md + routine.json. Recheck private literals before sharing. Tools, credentials and approvals are not included. Some MCP hosts block downloads; use the CLI export if needed.'); } catch(e) { notice(e.message,true); } };
    row.append(run, inspect, share); card.append(row); $('routines').append(card);
  }
}
async function refresh() {
  if (refreshing) return; refreshing = true;
  try {
    state = await api('state'); $('initialize').hidden = true;
    renderRoutines(state.routines); $('state').textContent = state.run === 'idle' ? state.recording.state : state.run;
    const r = state.recording; $('recording').replaceChildren();
    for (const id of ['preview','save','discard']) $(id).disabled = !['recording','invalid'].includes(r.state) || Boolean(r.pending);
    if (r.state === 'recording' || r.state === 'invalid') $('recording').append(element('strong', r.name), element('p', `${r.steps} successful calls captured · ${r.state}`), element('p', r.error || 'Preview the bindings and add success checks before saving.'));
    else $('recording').append(element('strong', state.run === 'complete' ? 'Ready for the next run.' : 'Your workflow starts here.'), element('p', r.state === 'expired' ? 'Recording expired. Raw capture was discarded.' : 'Only selected calls from an explicit capture are recorded.'));
    $('events').replaceChildren(...state.events.map(e => { const div = element('div', undefined, `event ${e.status}`); div.append(element('span', '', 'dot'), element('span', `${e.id} · ${e.tool} · ${e.status}`)); return div; }));
    const key = JSON.stringify(state.approvals);
    if (key !== approvalsKey) {
      approvalsKey = key; $('approvals').replaceChildren();
      for (const item of state.approvals) {
        const card = element('section', undefined, 'approval'); card.dataset.approvalId = item.id; card.append(element('h3', `Review: ${item.request.stage}`));
        if (item.request.note) card.append(element('p', item.request.note));
        card.append(element('pre', JSON.stringify(item.request, null, 2)));
        const allow = element('button', 'Approve once'); const deny = element('button', 'Deny', 'secondary');
        for (const [button, answer] of [[allow,true],[deny,false]]) button.onclick = async () => { button.disabled = true; try { await api('approval', { id: item.id, allow: answer }); await refresh(); } catch(e) { notice(e.message,true); } };
        card.append(allow, deny); $('approvals').append(card);
      }
    }
    const servers = JSON.stringify(state.servers || []);
    if (servers !== serverKey) { serverKey = servers; $('servers').replaceChildren(...(state.servers || []).map(server => { const card = element('div'); card.append(element('p', `${server.name} · ${server.connected ? 'connected' : 'not running'} · ${server.tools.join(', ')}`)); const button = element('button', server.connected ? 'Connected' : 'Review & connect'); button.disabled = server.connected; button.onclick = () => action('connect', { server: server.name }); card.append(button); return card; })); }
    const { tools } = await api('tools'); const nextKey = JSON.stringify(tools);
    if (nextKey !== toolKey) {
      discovered = tools; toolKey = nextKey; $('record-tools').replaceChildren(); $('call-name').replaceChildren();
      for (const tool of tools) { const option = element('option', tool.name); option.value = tool.name; $('record-tools').append(option); if (/^(webmcp|mcp):/.test(tool.name)) $('call-name').append(option.cloneNode(true)); }
      argumentFields($('call-fields'), tools.find(t => t.name === $('call-name').value));
    }
  } catch(error) { if (!state) notice(error.message, true); }
  finally { refreshing = false; }
}
function form(id, handler) { $(id).onsubmit = event => { event.preventDefault(); try { handler(); } catch(error) { notice(error.message, true); } }; }
form('record-form', () => action('record', { name: $('record-name').value, inputs: $('record-advanced').open ? parse('record-inputs') : exampleInputs($('input-rows')), tools: [...$('record-tools').selectedOptions].map(o => o.value) }));
form('open-form', () => action('open', { url: $('url').value }));
form('call-form', () => action('call', { name: $('call-name').value, arguments: $('call-advanced').open ? parse('call-args') : argumentsValue($('call-fields')) }));
form('import-form', () => action('import', { routine: parse('import-json') }));
const checks = () => $('checks-advanced').open ? parse('checks') : checksValue($('check-rows'));
$('preview').onclick = () => { try { void action('preview', { checks: checks() }); } catch(e) { notice(e.message,true); } };
$('save').onclick = () => { try { void action('save', { checks: checks(), expose: $('expose').checked }); } catch(e) { notice(e.message,true); } };
$('add-input').onclick = () => inputRow($('input-rows'));
inputRow($('input-rows'), 'category', 'notes');
$('call-name').onchange = () => argumentFields($('call-fields'), discovered.find(t => t.name === $('call-name').value));
$('add-check').onclick = async () => { const routine = await action('preview', { checks: checks() }); if (routine) checkRow($('check-rows'), routine); };
$('import-file').onchange = async () => { const file = $('import-file').files[0]; if (!file) return; if (file.size > 512 * 1024) return notice('Routine JSON exceeds 512 KB.', true); $('import-json').value = await file.text(); notice('File loaded. Review it, then choose Review & import. Import never executes.'); };
$('discard').onclick = () => action('discard'); $('stop').onclick = () => action('stop');
$('init').onclick = () => { parentAction('initialize'); notice('Initialization requested in DSH.'); };
void refresh(); setInterval(() => { if (!document.hidden) void refresh(); }, 800);
