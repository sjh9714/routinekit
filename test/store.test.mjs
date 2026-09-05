import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Recorder } from '../src/core.mjs';
import { RoutineStore, exportSkill, skillBundle, savedToolName } from '../src/store.mjs';
import { unzipSync, strFromU8 } from 'fflate';
test('save, read, list and export real files; no overwrite or traversal', async () => {
  const root = await mkdtemp(join(tmpdir(),'routinekit-store-test-'));
  try {
    const store = new RoutineStore(join(root,'routines')); const recorder = new Recorder();
    recorder.begin({ name: 'example-flow', inputs: { query: 'example-private-input' }, tools: [{ name: 'search', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] });
    recorder.finish(recorder.start('search'), 'search', { query: 'example-private-input' }, { output: 'example-private-output' });
    const routine = recorder.draft(); await store.save(routine);
    await assert.rejects(store.save(routine), { code: 'EXISTS' });
    assert.equal((await store.list()).length, 1); assert.deepEqual(await store.get('example-flow'), routine);
    assert.throws(() => store.path('../outside'), { code: 'NAME' });
    const exported = await exportSkill(routine, join(root,'example-flow'));
    const data = await readFile(join(exported,'routine.json'),'utf8'); assert.equal(data.includes('example-private-'), false);
    const skill = await readFile(join(exported,'SKILL.md'),'utf8'); assert.match(skill,/name: example-flow/); assert.match(skill,/routine_run/);
    const bundle = unzipSync(skillBundle(routine)); assert.deepEqual(Object.keys(bundle).sort(), ['SKILL.md','routine.json']); assert.equal(strFromU8(bundle['SKILL.md']), skill); assert.equal(strFromU8(bundle['routine.json']), data);
    assert.ok(savedToolName('a'.repeat(64)).length <= 64); assert.notEqual(savedToolName('a'.repeat(64)), savedToolName('a'.repeat(63) + 'b'));
    await assert.rejects(exportSkill(routine, exported));
  } finally { await rm(root,{recursive:true}); }
});
