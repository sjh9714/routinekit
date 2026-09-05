import { App } from '@modelcontextprotocol/ext-apps';

async function main() {
  const app = new App({ name: 'RoutineKit', version: '0.2.0' });
  app.ontoolresult = () => {}; // Registered before connect; state is fetched explicitly.
  await app.connect();
  async function call(name, args = {}) {
    const result = await app.callServerTool({ name, arguments: args });
    const text = result.content?.find(c => c.type === 'text')?.text;
    if (!text) throw new Error('The host returned no tool result.');
    const value = JSON.parse(text);
    if (result.isError) throw new Error(value.message || 'Tool failed.');
    return value;
  }
  window.routinekitAPI = async (path, value) => {
    if (path === 'state') return { ...await call('routine_list'), approvals: [], dsh: false, app: true };
    if (path === 'tools') return call('routine_tools');
    if (path.startsWith('routine?')) return call('routine_inspect', { name: new URLSearchParams(path.split('?')[1]).get('name') });
    if (path.startsWith('bundle?')) return call('routine_export', { name: new URLSearchParams(path.split('?')[1]).get('name') });
    if (path !== 'action') throw new Error('Approvals must use the host human-elicitation prompt.');
    const { action, args = {} } = value;
    if (action === 'open') return call('routine_web_open', { url: args.url });
    if (action === 'connect') return call('routine_mcp_connect', { server: args.server });
    if (action === 'call') return call(args.name.startsWith('mcp:') ? 'routine_mcp_call' : 'routine_web_call', { name: args.name, arguments_json: JSON.stringify(args.arguments) });
    if (action === 'record') return call('routine_record', { name: args.name, inputs_json: JSON.stringify(args.inputs), tools: args.tools });
    if (action === 'run') return call('routine_run', { name: args.name, inputs_json: JSON.stringify(args.inputs) });
    if (action === 'save') return call('routine_save', { checks_json: JSON.stringify(args.checks), expose: args.expose });
    if (action === 'preview') return call('routine_preview', { checks_json: JSON.stringify(args.checks) });
    if (action === 'import') return call('routine_import', { routine_json: JSON.stringify(args.routine) });
    if (['discard','stop'].includes(action)) return call(`routine_${action}`);
    throw new Error('Unsupported workbench action.');
  };
  document.querySelector('.local').textContent = 'MCP App · review actions in your host';
  await import('../web/app.js');
}
void main().catch(() => { const notice = document.getElementById('notice'); notice.hidden = false; notice.textContent = 'This panel needs an MCP Apps host. Use routinekit open for the standalone workbench.'; });
