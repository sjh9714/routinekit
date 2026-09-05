import { readFile, lstat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fail, jsonCopy, assertNoSecrets, checkAbort, toolContract, fingerprint, validateSchema, LIMITS } from './core.mjs';

// This is an explicit process configuration, not an import of another host's
// credentials or permissions. Nothing is started by discovery or listTools.
export function validateConfig(value) {
  const config = jsonCopy(value);
  if (!config || Object.keys(config).some(k => k !== 'servers') || !config.servers || typeof config.servers !== 'object' || Array.isArray(config.servers)) fail('CONFIG', 'Expected a servers object.');
  if (Object.keys(config.servers).length > 8) fail('CONFIG', 'Configure at most eight local servers.');
  for (const [alias, server] of Object.entries(config.servers)) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(alias) || !server || Object.keys(server).some(k => !['command','args','cwd','envFrom','tools'].includes(k))) fail('CONFIG', 'Invalid server configuration.');
    if (typeof server.command !== 'string' || !isAbsolute(server.command)) fail('CONFIG', 'Use the absolute path of an already installed executable; no shell or automatic package download.');
    if (!Array.isArray(server.args) || server.args.length > 80 || server.args.some(a => typeof a !== 'string')) fail('CONFIG', 'Server args must be a bounded string array.');
    if (server.cwd !== undefined && (typeof server.cwd !== 'string' || !isAbsolute(server.cwd))) fail('CONFIG', 'cwd must be absolute.');
    if (!Array.isArray(server.tools) || !server.tools.length || server.tools.length > 40 || server.tools.some(n => typeof n !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(n)) || new Set(server.tools).size !== server.tools.length) fail('CONFIG', 'Explicitly allow 1–40 unique tool names.');
    if (server.envFrom !== undefined && (!Array.isArray(server.envFrom) || server.envFrom.length > 30 || server.envFrom.some(n => typeof n !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(n)))) fail('CONFIG', 'envFrom contains environment variable names, never values.');
    assertNoSecrets(server.command); assertNoSecrets(server.args);
  }
  return config;
}
export async function readConfig(file) {
  if (!file) return { servers: {} };
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.bytes) fail('CONFIG', 'Use a bounded regular configuration file.');
  return validateConfig(JSON.parse(await readFile(file, 'utf8')));
}
export class UpstreamMCP {
  constructor(config = { servers: {} }) { this.config = validateConfig(config); this.connections = new Map(); this.closing = new Set(); }
  closeRecord(record) {
    // Cancellation and Stop can arrive together. Await the original close:
    // a second SDK close returns early once its process reference is cleared.
    if (!record.closing) {
      record.closing = record.client.close(); this.closing.add(record.closing);
      record.closing.then(() => this.closing.delete(record.closing), () => this.closing.delete(record.closing));
    }
    return record.closing;
  }
  status() { return Object.keys(this.config.servers).map(name => ({ name, connected: this.connections.has(name), tools: this.config.servers[name].tools })); }
  review(name) {
    const config = this.config.servers[name]; if (!config) fail('MCP_SERVER', 'Select an explicitly configured server.');
    return { stage: 'connect', server: name, ...jsonCopy(config), note: 'Start this installed local process with the listed tool allowlist. It is NOT an OS sandbox. Trust its executable and configure its own file/network restrictions. Only listed environment names plus the MCP SDK platform defaults are inherited. Server logs are discarded; no sibling host permissions are imported.' };
  }
  async connect(name, { signal } = {}) {
    checkAbort(signal);
    if (this.connections.has(name)) return { server: name, connected: true };
    const config = this.config.servers[name]; if (!config) fail('MCP_SERVER', 'Unknown server.');
    const env = {};
    for (const key of config.envFrom || []) { if (process.env[key] === undefined) fail('MCP_ENV', 'A configured environment variable is missing.'); env[key] = process.env[key]; }
    const transport = new StdioClientTransport({ command: config.command, args: config.args, cwd: config.cwd, env, stderr: 'pipe', maxBufferSize: LIMITS.bytes * 2 });
    transport.stderr?.resume();
    const client = new Client({ name: 'routinekit', version: '0.2.0' });
    const record = { client, transport, config }; this.connections.set(name, record);
    const abort = () => { void this.closeRecord(record); }; signal?.addEventListener('abort', abort, { once: true });
    client.onerror = () => {}; // Never emit upstream errors or stderr containing private data.
    client.onclose = () => { if (this.connections.get(name) === record) this.connections.delete(name); };
    try {
      await client.connect(transport, { signal, timeout: 30_000 }); checkAbort(signal);
      const tools = await this.listServer(name, signal);
      if (tools.length !== config.tools.length) fail('MCP_TOOLS', 'A configured tool is unavailable. Check the exact allowlist.');
      return { server: name, connected: true, tools: tools.map(t => t.name) };
    } catch (error) { this.connections.delete(name); await this.closeRecord(record); checkAbort(signal); throw error; }
    finally { signal?.removeEventListener('abort', abort); }
  }
  async listServer(alias, signal) {
    const record = this.connections.get(alias); if (!record) return [];
    const tools = []; let cursor; const cursors = new Set();
    for (let page = 0; page < 20; page++) {
      const result = await record.client.listTools(cursor ? { cursor } : {}, { signal, timeout: 10_000 });
      for (const tool of result.tools) if (record.config.tools.includes(tool.name)) {
        const info = record.client.getServerVersion();
        const contract = toolContract({ ...tool, name: `mcp:${alias}:${tool.name}`, source: { server: alias, name: info.name, version: info.version } });
        tools.push({ ...contract, description: typeof tool.description === 'string' ? tool.description.slice(0, 1000) : '' });
      }
      if (!result.nextCursor) {
        if (new Set(tools.map(t => t.name)).size !== tools.length) fail('MCP_TOOLS', 'Duplicate upstream tool identities.');
        return tools;
      }
      if (cursors.has(result.nextCursor)) break;
      cursor = result.nextCursor; cursors.add(cursor);
    }
    fail('MCP_LIMIT', 'Upstream tool pagination exceeded the bounded discovery limit.');
  }
  async tools() { return (await Promise.all([...this.connections.keys()].map(alias => this.listServer(alias)))).flat(); }
  async call(name, args, { signal, contract } = {}) {
    const [, alias, toolName] = name.split(':'); const record = this.connections.get(alias);
    if (!record || !record.config.tools.includes(toolName)) fail('MCP_TOOL', 'Connect the matching allowlisted server first.');
    const current = (await this.listServer(alias, signal)).find(t => t.name === name);
    if (!current || !contract || fingerprint(toolContract(current)) !== fingerprint(toolContract(contract))) fail('TOOL_CHANGED', 'The upstream tool contract changed.');
    validateSchema(contract.inputSchema, args); checkAbort(signal);
    const abort = () => { void this.closeRecord(record); }; signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await record.client.callTool({ name: toolName, arguments: args }, undefined, { signal, timeout: 60_000 });
      checkAbort(signal);
      if (result.isError) fail('MCP_TOOL_FAILED', 'The upstream tool failed. No further steps were started.');
      let value;
      if (result.structuredContent !== undefined) value = result.structuredContent;
      else if (result.content?.length === 1 && result.content[0].type === 'text') {
        const text = result.content[0].text;
        try { value = JSON.parse(text); } catch { value = { text }; }
      } else fail('MCP_OUTPUT', 'Capture requires structured JSON or one text result. Binary and multi-part results are unsupported.');
      value = jsonCopy(value); assertNoSecrets(value);
      if (contract.outputSchema) validateSchema(contract.outputSchema, value, 'OUTPUT_CHANGED');
      return value;
    } finally { signal?.removeEventListener('abort', abort); if (record.closing) await record.closing; }
  }
  async close() { const records = [...this.connections.values()]; this.connections.clear(); await Promise.all([...records.map(r => this.closeRecord(r)), ...this.closing]); }
}
