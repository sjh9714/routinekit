import { mkdir, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { validateRoutine, fail, LIMITS } from './core.mjs';

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
      try { const r = await this.get(file.replace('.routine.json', '')); items.push({ name: r.name, steps: r.steps.length, inputs: r.inputs, tools: [...new Set(r.steps.map(s => s.tool))] }); } catch { /* Invalid imports are not runnable. */ }
    }
    return items;
  }
}
export function skillMarkdown(routine) {
  const r = validateRoutine(routine);
  return `---\nname: ${r.name}\ndescription: Replay the reviewed ${r.name} RoutineKit workflow with fresh inputs and human approval.\n---\n\n# ${r.name}\n\nThis is an executable routine, not permission to run arbitrary commands.\n\n1. Read \`routine.json\` and review every tool, origin, literal, binding, and success check with the user.\n2. Use RoutineKit's \`routine_import\` tool to import that JSON (or \`routinekit import routine.json\`). Never silently replace an existing routine.\n3. Ask for the required inputs: ${Object.keys(r.inputs.properties).map(k => `\`${k}\``).join(', ') || 'none'}.\n4. Use \`routine_run\` with name \`${r.name}\` and those inputs. Its approval gate and the connected host's permissions must remain enabled.\n5. If a tool, origin, or schema differs, stop. Do not silently translate tools, execute a shell fallback, or claim success.\n\nDSH-native tool routines require matching tools in DSH. WebMCP routines require the original origin and compatible tools. No credentials, recorded outputs, or example input values travel with this bundle; reviewed literal arguments may still be private.\n`;
}
export async function exportSkill(routine, directory) {
  const r = validateRoutine(routine); const target = resolve(directory);
  await mkdir(target, { recursive: false, mode: 0o700 });
  await writeFile(join(target, 'routine.json'), JSON.stringify(r, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(join(target, 'SKILL.md'), skillMarkdown(r), { flag: 'wx', mode: 0o600 });
  return target;
}
