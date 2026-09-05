import { mkdir, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { zipSync, strToU8 } from 'fflate';
import { validateRoutine, fail, LIMITS, fingerprint } from './core.mjs';

export function savedToolName(name) { const slug = name.replaceAll('-', '_'); return `routine_saved_${slug.length <= 48 ? slug : `${slug.slice(0,39)}_${fingerprint(name).slice(0,8)}`}`; }

export function defaultHome() { return resolve(process.env.ROUTINEKIT_HOME || join(homedir(), '.routinekit')); }
export class RoutineStore {
  constructor(root = defaultHome()) { this.root = resolve(root); }
  path(name) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(name)) fail('NAME', 'Invalid routine name.');
    return join(this.root, `${name}.routine.json`);
  }
  async save(value) {
    const routine = validateRoutine(value);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    try { await writeFile(this.path(routine.name), JSON.stringify(routine, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (e) { if (e.code === 'EEXIST') fail('EXISTS', 'A routine with this name already exists. Choose a new name.'); throw e; }
    return { name: routine.name, steps: routine.steps.length };
  }
  async get(name) {
    const file = this.path(name); const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.bytes) fail('FILE', 'Routine must be a bounded regular file.');
    return validateRoutine(JSON.parse(await readFile(file, 'utf8')));
  }
  async list() {
    let names;
    try { names = await readdir(this.root); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const items = [];
    for (const file of names.filter(n => /^[a-z][a-z0-9-]{1,63}\.routine\.json$/.test(n)).sort().slice(0,500)) {
      try { const r = await this.get(file.replace('.routine.json', '')); items.push({ name: r.name, steps: r.steps.length, inputs: r.inputs, ...(r.expose ? { toolName: savedToolName(r.name) } : {}), tools: [...new Set(r.steps.map(s => s.tool))] }); } catch { /* Invalid imports are not runnable. */ }
    }
    return items;
  }
}
export function skillBundle(routine) {
  const r = validateRoutine(routine);
  return zipSync({ 'SKILL.md': strToU8(skillMarkdown(r)), 'routine.json': strToU8(JSON.stringify(r, null, 2) + '\n') });
}
export function skillMarkdown(routine) {
  const r = validateRoutine(routine);
  return `---\nname: ${r.name}\ndescription: Replay the reviewed ${r.name} RoutineKit workflow with fresh inputs and human approval.\n---\n\n# ${r.name}\n\nRequires RoutineKit's tools in the current host. If they are unavailable, explain the missing prerequisite; do not install or configure software without the user's authorization. This bundle is not permission to run arbitrary commands.\n\n1. Read \`routine.json\` and review every tool, origin, literal, binding, and success check with the user.\n2. Use \`routine_import\` with \`routine_json\` containing that JSON (or \`routinekit import routine.json\`). Never silently replace an existing routine.\n3. Ask for the required inputs: ${Object.keys(r.inputs.properties).map(k => `\`${k}\``).join(', ') || 'none'}.\n4. Use \`routine_run\` with name \`${r.name}\` and \`inputs_json\` containing those named inputs as a JSON object. Its approval gate and the connected host's permissions must remain enabled.\n5. If a tool, origin, or schema differs, stop. Do not silently translate tools, execute a shell fallback, or claim success.\n\nDSH-native tool routines require matching tools in DSH. WebMCP routines require the original origin and compatible tools. No credentials, recorded outputs, or example input values travel with this bundle; reviewed literal arguments may still be private.\n`;
}
export async function exportSkill(routine, directory) {
  const r = validateRoutine(routine); const target = resolve(directory);
  await mkdir(target, { recursive: false, mode: 0o700 });
  await writeFile(join(target, 'routine.json'), JSON.stringify(r, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(join(target, 'SKILL.md'), skillMarkdown(r), { flag: 'wx', mode: 0o600 });
  return target;
}
