import { RoutineService } from './service.mjs';
import { serveFixture } from './fixture.mjs';
import { WebMCPBrowser } from './browser.mjs';
/** A disclosed scripted tutorial through a real native-WebMCP browser, not a model simulation. */
export async function prepareDemo({ root, headless = false, port = 0 } = {}) {
  const fixture = await serveFixture({ port }); const browser = new WebMCPBrowser({ headless });
  const service = new RoutineService({ root, browser });
  try {
    await browser.open(fixture.url);
    const tools = (await service.tools()).filter(t => ['webmcp:catalog_search','webmcp:catalog_open'].includes(t.name));
    service.recorder.begin({ name: `find-project-${Date.now().toString(36)}`, inputs: { category: 'notes' }, tools });
    const a = { category: 'notes' }; const t1 = service.recorder.start('webmcp:catalog_search');
    const result = await browser.call('catalog_search', a); service.recorder.finish(t1, 'webmcp:catalog_search', a, result);
    const b = { id: result.items[0].id }; const t2 = service.recorder.start('webmcp:catalog_open');
    const opened = await browser.call('catalog_open', b); service.recorder.finish(t2, 'webmcp:catalog_open', b, opened);
    return { service, fixture, close: async () => { await service.close(); await fixture.close(); } };
  } catch(error) { await service.close(); await fixture.close(); throw error; }
}
