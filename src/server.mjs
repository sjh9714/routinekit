import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { safeError, fail, jsonCopy, LIMITS } from './core.mjs';
import { skillMarkdown } from './store.mjs';

export function trustedRequest(req) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false;
  let host;
  try { host = new URL(`http://${req.headers.host}`); } catch { return false; }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return false;
  return true;
}
function respond(res, status, value, contentType = 'application/json') {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'" });
  res.end(contentType === 'application/json' ? JSON.stringify(value) : value);
}
async function body(req) {
  if (!String(req.headers['content-type']).startsWith('application/json')) fail('CONTENT_TYPE', 'JSON required.');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > LIMITS.bytes) fail('LIMIT', 'Request too large.'); chunks.push(chunk); }
  try { return jsonCopy(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { fail('JSON', 'Invalid JSON body.'); }
}

export class ApprovalQueue {
  pending = new Map();
  ask(request, signal) {
    if (signal?.aborted) return Promise.resolve(false);
    const id = randomBytes(16).toString('hex');
    return new Promise(resolve => {
      const finish = allowed => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); this.pending.delete(id); resolve(allowed); };
      const cancel = () => finish(false); const timer = setTimeout(cancel, 120_000); timer.unref();
      signal?.addEventListener('abort', cancel, { once: true });
      this.pending.set(id, { id, request: jsonCopy(request), finish });
    });
  }
  list() { return [...this.pending.values()].map(({ id, request }) => ({ id, request })); }
  answer(id, allow) { const item = this.pending.get(id); if (!item) fail('APPROVAL', 'This approval expired.'); item.finish(allow === true); }
  close() { for (const item of this.pending.values()) item.finish(false); }
}

export function createHandler({ resolveService, authorize, prefix = '', approvals = new ApprovalQueue(), dsh = false }) {
  const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
  return async (req, res) => {
    if (!trustedRequest(req)) { respond(res, 403, { error: 'Local, same-origin access only.' }); return; }
    const url = new URL(req.url, 'http://local.invalid'); const path = url.pathname.slice(prefix.length) || '/';
    try {
      if (req.method === 'GET' && assets[path]) { const [file, type] = assets[path]; respond(res, 200, await readFile(new URL(`../web/${file}`, import.meta.url)), type); return; }
      if (!authorize(req)) { respond(res, 401, { error: 'Open the authenticated workbench link.' }); return; }
      const service = resolveService(req);
      if (!service) { respond(res, 409, { code: 'SESSION_REQUIRED', error: 'Initialize RoutineKit in this DSH task first.' }); return; }
      if (req.method === 'GET' && path === '/api/state') { respond(res, 200, { ...await service.state(), approvals: approvals.list(), dsh }); return; }
      if (req.method === 'GET' && path === '/api/tools') { respond(res, 200, { tools: await service.tools() }); return; }
      if (req.method === 'GET' && path === '/api/routine') { respond(res, 200, await service.store.get(url.searchParams.get('name'))); return; }
      if (req.method === 'GET' && path === '/api/skill') { respond(res, 200, skillMarkdown(await service.store.get(url.searchParams.get('name'))), 'text/plain'); return; }
      if (req.method !== 'POST') { respond(res, 404, { error: 'Not found.' }); return; }
      const value = await body(req);
      if (path === '/api/approval') { approvals.answer(value.id, value.allow); respond(res, 200, { ok: true }); return; }
      if (path !== '/api/action') { respond(res, 404, { error: 'Not found.' }); return; }
      if (!['record', 'preview', 'save', 'discard', 'run', 'open', 'call', 'stop', 'import'].includes(value.action)) fail('ACTION', 'Unknown workbench action.');
      if (value.action === 'stop') approvals.close();
      if (dsh && value.action === 'run') {
        const r = await service.store.get(value.args?.name);
        if (r.steps.some(step => step.tool.startsWith('dsh:'))) { respond(res, 409, { code: 'DSH_RUN', error: 'Use the Run in DSH button so existing host permissions remain in effect.' }); return; }
      }
      // Approval requests are separate UI interactions. No boolean in the action body can grant consent.
      const controller = new AbortController();
      const disconnected = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close', disconnected);
      try {
        const result = await service.invoke(value.action, value.args || {}, { signal: controller.signal, approve: request => approvals.ask(request, controller.signal) });
        respond(res, 200, result);
      } finally { res.removeListener('close', disconnected); }
    } catch (error) { const safe = safeError(error); respond(res, 400, { code: safe.code, error: safe.message }); }
  };
}
export async function serveWorkbench(service, { port = 0 } = {}) {
  const token = randomBytes(32).toString('hex'); const approvals = new ApprovalQueue();
  const handler = createHandler({ resolveService: () => service, authorize: req => req.headers['x-routinekit-token'] === token, approvals });
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}/#token=${token}`, token, approvals, close: async () => { approvals.close(); await service.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); } };
}
