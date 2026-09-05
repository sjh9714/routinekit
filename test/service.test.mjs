import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoutineService } from '../src/service.mjs';

test('stop while opening approval is pending prevents a later browser launch', async () => {
  let answer, entered, opened = 0;
  const ready = new Promise(resolve => { entered = resolve; });
  const service = new RoutineService({ browser: { open: async () => { opened++; }, close: async () => {} } });
  const operation = service.invoke('open', { url: 'https://example.com' }, {
    approve: () => { entered(); return new Promise(resolve => { answer = resolve; }); },
  });
  const outcome = operation.then(() => null, error => error);
  await ready;
  await service.invoke('stop');
  answer(true);
  assert.equal((await outcome)?.code, 'CANCELLED');
  assert.equal(opened, 0);
  assert.equal(service.busy, false);
  await service.close();
});
