import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { RoutineService } from './service.mjs';
import { TOOL_SPECS, invokeTool } from './tools.mjs';
import { safeError, fail } from './core.mjs';

export function createMCPServer(service = new RoutineService()) {
  const server = new Server({ name: 'routinekit', version: '0.1.0' }, { capabilities: { tools: {} }, instructions: 'RoutineKit captures explicit selected successful tool calls and replays reviewed routines. Never approve elicitation on behalf of the user. Do not replace failed routines with unrestricted shell or browser actions. Use routine_tools to discover exact names.' });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_SPECS }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
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
