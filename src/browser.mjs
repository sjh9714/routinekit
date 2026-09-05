import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { fail, checkAbort, jsonCopy, validateSchema, toolContract, RoutineError, assertNoSecrets } from './core.mjs';

export function checkedUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('URL', 'Use an absolute HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('URL', 'Only credential-free HTTP(S) URLs are supported.');
  assertNoSecrets(value);
  return url;
}
export async function launchBrowser({ headless = false } = {}) {
  const args = ['--enable-experimental-web-platform-features'];
  const options = { headless, args };
  if (process.env.ROUTINEKIT_BROWSER_PATH) return chromium.launch({ ...options, executablePath: process.env.ROUTINEKIT_BROWSER_PATH });
  if (existsSync(chromium.executablePath())) return chromium.launch(options);
  for (const channel of ['chrome', 'msedge']) {
    try { return await chromium.launch({ ...options, channel }); } catch { /* Try another installed Chromium browser. */ }
  }
  fail('BROWSER_MISSING', 'Install Chrome/Edge, or run: npx playwright-core@1.63.0 install chromium');
}

/** One blank, isolated browser per connection. No profile or cookies are imported. */
export class WebMCPBrowser {
  constructor({ headless = false } = {}) { this.headless = headless; this.approveEachCall = true; }
  async open(value) {
    await this.close();
    const url = checkedUrl(value); this.origin = url.origin;
    this.browser = await launchBrowser({ headless: this.headless });
    this.context = await this.browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', viewport: { width: 1180, height: 760 } });
    this.page = await this.context.newPage();
    this.context.on('page', page => { if (page !== this.page) void page.close(); });
    this.page.on('download', download => { void download.cancel(); });
    this.page.on('dialog', dialog => { void dialog.dismiss(); });
    await this.context.route('**/*', route => {
      const req = route.request();
      let target;
      try { target = new URL(req.url()); } catch { return route.abort(); }
      if (target.origin !== this.origin || (!['GET', 'HEAD', 'OPTIONS'].includes(req.method()) && !this.executing)) return route.abort();
      return route.continue();
    });
    try {
      await this.page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await this.page.waitForFunction(() => !!document.modelContext?.getTools || !!navigator.modelContextTesting?.listTools, null, { timeout: 5000 });
      if (new URL(this.page.url()).origin !== this.origin) fail('ORIGIN', 'Navigation left the approved origin.');
      this.mode = await this.page.evaluate(() => document.modelContext?.getTools ? 'webmcp' : 'chromium-testing');
      return { url: this.page.url(), origin: this.origin, mode: this.mode, tools: await this.list() };
    } catch (error) { await this.close(); throw error instanceof RoutineError ? error : new RoutineError('WEBMCP_UNAVAILABLE', 'This page does not expose supported WebMCP tools. No screen-scraping fallback was used.'); }
  }
  async list() {
    if (!this.page || this.page.isClosed()) fail('BROWSER_CLOSED', 'Open a WebMCP page first.');
    if (new URL(this.page.url()).origin !== this.origin) fail('ORIGIN', 'The page left the approved origin.');
    const list = await this.page.evaluate(async () => {
      const api = document.modelContext;
      const tools = api?.getTools ? await api.getTools() : await navigator.modelContextTesting.listTools();
      return tools.map(t => ({ name: t.name, description: t.description || '', inputSchema: typeof t.inputSchema === 'string' ? JSON.parse(t.inputSchema) : t.inputSchema, origin: t.origin || location.origin, effect: 'unknown' }));
    });
    const sameOrigin = jsonCopy(list).filter(t => t.origin === this.origin);
    if (new Set(sameOrigin.map(t => t.name)).size !== sameOrigin.length) fail('AMBIGUOUS_TOOL', 'Duplicate WebMCP tool names cannot be replayed safely.');
    return sameOrigin.map(t => ({ ...toolContract(t), description: t.description }));
  }
  async describe(name, contract) {
    if (contract?.origin && contract.origin !== this.origin) return undefined;
    return (await this.list()).find(t => t.name === name);
  }
  async call(name, args, { signal, contract } = {}) {
    if (this.executing) fail('BUSY', 'Only one WebMCP call may run at a time.');
    checkAbort(signal);
    const tool = await this.describe(name, contract);
    if (!tool) fail('TOOL_MISSING', 'The required WebMCP tool is unavailable at this origin.');
    validateSchema(tool.inputSchema, args);
    const close = () => { void this.close(); };
    signal?.addEventListener('abort', close, { once: true });
    const timer = setTimeout(close, 30_000); timer.unref();
    this.executing = true;
    try {
      const value = await this.page.evaluate(async ({ name, args }) => {
        if (document.modelContext?.getTools) {
          const tools = await document.modelContext.getTools();
          const tool = tools.find(t => t.name === name && (!t.origin || t.origin === location.origin));
          if (!tool) throw new Error('Tool disappeared');
          const result = await document.modelContext.executeTool(tool, JSON.stringify(args));
          if (typeof result === 'string') { try { return JSON.parse(result); } catch { return { text: result }; } }
          return result;
        }
        const result = await navigator.modelContextTesting.executeTool(name, JSON.stringify(args));
        if (typeof result === 'string') { try { return JSON.parse(result); } catch { return { text: result }; } }
        return result;
      }, { name, args: jsonCopy(args) });
      checkAbort(signal);
      if (value?.isError === true) fail('TOOL_FAILED', 'The WebMCP tool reported a failure.');
      return jsonCopy(value);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', close); this.executing = false; }
  }
  async close() {
    const browser = this.browser;
    this.browser = undefined; this.context = undefined; this.page = undefined;
    await browser?.close().catch(() => {});
  }
}
