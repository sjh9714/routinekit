const node = (tag, text) => { const el = document.createElement(tag); if (text) el.textContent = text; return el; };
export function scalar(value, type) {
  if (type === 'number') { if (!value.trim() || !Number.isFinite(Number(value))) throw new Error('Enter a finite number.'); return Number(value); }
  if (type === 'boolean') { if (!['true','false'].includes(value)) throw new Error('Choose true or false.'); return value === 'true'; }
  return value;
}
export function inputRow(container, name = '', value = '') {
  const row = node('div'); row.className = 'input-row';
  const key = node('input'); key.placeholder = 'input_name'; key.value = name; key.setAttribute('aria-label', 'Input name');
  const type = node('select'); type.setAttribute('aria-label', 'Input type');
  for (const name of ['string','number','boolean']) { const option = node('option', name); option.value = name; type.append(option); }
  const example = node('input'); example.placeholder = 'Exact example value'; example.value = value; example.setAttribute('aria-label', 'Example value');
  const remove = node('button', 'Remove'); remove.type = 'button'; remove.className = 'quiet'; remove.onclick = () => row.remove();
  row.append(key, type, example, remove); container.append(row);
}
export function exampleInputs(container) {
  const entries = [...container.children].map(row => { const [key, type, value] = row.querySelectorAll('input,select'); if (!/^[a-z][a-z0-9_]{0,47}$/.test(key.value)) throw new Error('Use a lowercase input_name.'); return [key.value, scalar(value.value, type.value)]; });
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error('Input names must be unique.');
  return Object.fromEntries(entries);
}
export function argumentFields(container, tool) {
  container.replaceChildren();
  for (const [key, schema] of Object.entries(tool?.inputSchema?.properties || {})) {
    const label = node('label', key); const type = ['string','number','boolean'].includes(schema.type) ? schema.type : 'json';
    const input = node(type === 'boolean' ? 'select' : type === 'json' ? 'textarea' : 'input');
    input.dataset.key = key; input.dataset.type = type; input.dataset.required = String(tool.inputSchema.required?.includes(key) || false);
    input.setAttribute('aria-label', `Argument ${key}`);
    if (type === 'boolean') for (const value of ['', 'true', 'false']) { const o = node('option', value || 'Choose…'); o.value = value; input.append(o); }
    else input.placeholder = input.dataset.required === 'true' ? 'Required' : 'Optional — leave blank to omit';
    if (type === 'number') { input.type = 'number'; input.step = 'any'; }
    if (type === 'json') label.append(node('small', ' Nested value: JSON required'));
    label.append(input); container.append(label);
  }
}
export function argumentsValue(container) {
  return Object.fromEntries([...container.querySelectorAll('[data-key]')].filter(el => el.value !== '' || el.dataset.required === 'true').map(el => [el.dataset.key, el.dataset.type === 'json' ? JSON.parse(el.value) : scalar(el.value, el.dataset.type)]));
}
export function outputPaths(schema, path = '') {
  if (schema?.type === 'object') return Object.entries(schema.properties || {}).flatMap(([key, value]) => outputPaths(value, `${path}/${key.replaceAll('~','~0').replaceAll('/','~1')}`));
  if (schema?.type === 'array') return outputPaths(schema.items, `${path}/0`);
  return ['string','number','boolean'].includes(schema?.type) ? [{ path, type: schema.type }] : [];
}
export function checkRow(container, routine) {
  const row = node('div'); row.className = 'check-row'; const path = node('select'); path.setAttribute('aria-label', 'Result field');
  for (const step of routine.steps) for (const field of outputPaths(step.expect)) { const option = node('option', `${step.id} ${field.path || '(whole result)'}`); option.value = JSON.stringify({ step: step.id, ...field }); path.append(option); }
  const comparison = node('select'); comparison.setAttribute('aria-label', 'Compare with');
  for (const name of ['', ...Object.keys(routine.inputs.properties)]) { const option = node('option', name ? `Input: ${name}` : 'Exact value'); option.value = name; comparison.append(option); }
  const value = node('input'); value.placeholder = 'Expected value (e.g. true)'; value.setAttribute('aria-label', 'Expected value');
  comparison.onchange = () => { value.disabled = Boolean(comparison.value); };
  const remove = node('button','Remove'); remove.type = 'button'; remove.className = 'quiet'; remove.onclick = () => row.remove();
  row.append(path, comparison, value, remove); container.append(row);
}
export function checksValue(container) {
  return [...container.children].map(row => { const [field, comparison, value] = row.querySelectorAll('select,input'); if (!field.value) throw new Error('Preview a successful capture before selecting checks.'); const {step,path,type} = JSON.parse(field.value); return { step, path, ...(comparison.value ? { input: comparison.value } : { equals: scalar(value.value, type) }) }; });
}
