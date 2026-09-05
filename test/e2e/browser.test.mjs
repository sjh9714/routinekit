import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serveFixture } from '../../src/fixture.mjs';
import { WebMCPBrowser } from '../../src/browser.mjs';
import { Recorder, replay } from '../../src/core.mjs';
import { createServer } from 'node:http';

test('three native WebMCP workflows capture and replay with changed inputs', { timeout: 90000 }, async t => {
  const fixture = await serveFixture(); const browser = new WebMCPBrowser({ headless: true });
  try {
    const opened = await browser.open(fixture.url);
    assert.equal(opened.tools.length, 6); assert.equal(opened.mode, 'webmcp');
    const scenarios = [
      { name: 'find-project', inputs: { category: 'notes' }, changed: { category: 'timer' }, names: ['catalog_search', 'catalog_open'], first: p => ({ category: p.category }), second: (r) => ({ id: r.items[0].id }), checks: [{ step: 'step_2', path: '/opened', equals: true }], verify: r => assert.equal(r.name, 'Tide Timer') },
      { name: 'city-plan', inputs: { city: 'seoul' }, changed: { city: 'tokyo' }, names: ['city_activities', 'plan_activity'], first: p => ({ city: p.city }), second: (r, p) => ({ city: p.city, activity_id: r.activities[0].id }), checks: [{ step: 'step_2', path: '/city', input: 'city' }, { step: 'step_2', path: '/ready', equals: true }], verify: r => assert.equal(r.activity, 'Sketch in Ueno Park') },
      { name: 'convert-distance', inputs: { kilometres: 10 }, changed: { kilometres: 20 }, names: ['convert_distance', 'format_distance'], first: p => ({ kilometres: p.kilometres }), second: r => ({ miles: r.miles }), checks: [{ step: 'step_2', path: '/formatted', equals: true }], verify: r => assert.equal(r.label, '12.427 miles') },
    ];
    for (const scenario of scenarios) await t.test(scenario.name, async () => {
      const recorder = new Recorder(); const tools = opened.tools.filter(t => scenario.names.includes(t.name));
      recorder.begin({ name: scenario.name, inputs: scenario.inputs, tools });
      const first = scenario.first(scenario.inputs); const token1 = recorder.start(scenario.names[0]);
      const output1 = await browser.call(scenario.names[0], first); recorder.finish(token1, scenario.names[0], first, output1);
      const second = scenario.second(output1, scenario.inputs); const token2 = recorder.start(scenario.names[1]);
      const output2 = await browser.call(scenario.names[1], second); recorder.finish(token2, scenario.names[1], second, output2);
      const routine = recorder.draft(scenario.checks);
      let approvals = 0; const result = await replay(routine, scenario.changed, browser, { approve: async () => { approvals++; return true; } });
      assert.equal(result.modelCalls, 0); assert.equal(result.steps, 2); assert.equal(approvals, 3); scenario.verify(result.result);
    });
  } finally { await browser.close(); await fixture.close(); }
  assert.equal(browser.page, undefined); assert.equal(browser.browser, undefined);
});

test('cancel during real browser navigation closes the owned browser', { timeout: 15000 }, async () => {
  let received;
  const requested = new Promise(resolve => { received = resolve; });
  const server = createServer(() => received());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = new WebMCPBrowser({ headless: true });
  const controller = new AbortController();
  try {
    const opening = browser.open(`http://127.0.0.1:${server.address().port}`, { signal: controller.signal });
    const outcome = opening.then(() => null, error => error);
    await requested;
    controller.abort();
    assert.equal((await outcome)?.code, 'CANCELLED');
    assert.equal(browser.page, undefined);
    assert.equal(browser.browser, undefined);
  } finally {
    await browser.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
});
