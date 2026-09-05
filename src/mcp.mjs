import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'node:fs/promises';
import { RoutineService } from './service.mjs';
import { TOOL_SPECS, invokeTool, savedTools } from './tools.mjs';
import { safeError, fail } from './core.mjs';

export function createMCPServer(service = new RoutineService()) {
  const uri = 'ui://routinekit/workbench.html'; const mimeType = 'text/html;profile=mcp-app';
  const appTool = { name: 'routine_workbench', description: 'Open the RoutineKit capture/replay workbench inside a compatible MCP Apps host. Human form elicitation is required for mutations.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, _meta: { ui: { resourceUri: uri } } };
  const server = new Server({ name: 'routinekit', version: '0.2.0' }, { capabilities: { tools: { listChanged: true }, resources: {} }, instructions: 'RoutineKit captures explicit selected successful tool calls and replays reviewed routines. Never approve elicitation on behalf of the user. Do not replace failed routines with unrestricted shell or browser actions. Use routine_tools to discover exact names.' });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOL_SPECS, appTool, ...await savedTools(service)] }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri, name: 'RoutineKit workbench', mimeType }] }));
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    if (request.params.uri !== uri) fail('RESOURCE', 'Unknown resource.');
    return { contents: [{ uri, mimeType, text: await readFile(new URL('../lib/mcp-app.html', import.meta.url), 'utf8'), _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }] };
  });
  service.changes.add(async () => { if (server.transport) await server.sendToolListChanged(); });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      if (request.params.name === appTool.name) return { content: [{ type: 'text', text: JSON.stringify(await service.state()) }] };
      const result = await invokeTool(service, request.params.name, request.params.arguments || {}, { signal: extra.signal, approve: async (review, signal) => {
        if (!server.getClientCapabilities()?.elicitation) fail('ELICITATION_REQUIRED', 'This MCP client must support human form elicitation. Use the local routinekit workbench if it does not; there is no auto-approve fallback.');
        const answer = await server.elicitInput({ mode: 'form', message: `RoutineKit — review ${review.stage}\n${JSON.stringify(review, null, 2)}`, requestedSchema: { type: 'object', properties: { approved: { type: 'boolean', title: 'Approve this exact action once', default: false } }, required: ['approved'] } }, { signal });
        return answer.action === 'accept' && answer.content?.approved === true;
      } });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch(error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify(safeError(error)) }] }; }
  });
  server.onclose = () => { void service.close(); };
  return server;
}
export async function serveMCP(service) { const server = createMCPServer(service); await server.connect(new StdioServerTransport()); return server; }
