import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server = new Server({ name: 'slow-test-only', version: '1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'wait', description: 'Never completes; cancellation test only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] }));
server.setRequestHandler(CallToolRequestSchema, () => new Promise(() => {}));
await server.connect(new StdioServerTransport());
