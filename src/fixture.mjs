import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
export async function serveFixture({ port = 0 } = {}) {
  const files = { '/': ['fixture.html', 'text/html'], '/fixture.js': ['fixture.js', 'text/javascript'], '/fixture.css': ['fixture.css', 'text/css'] };
  const server = createServer(async (req, res) => {
    const file = files[req.url];
    if (!file || req.method !== 'GET') { res.writeHead(404); res.end(); return; }
    try { res.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(await readFile(new URL(`../web/${file[0]}`, import.meta.url))); }
    catch { res.destroy(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
