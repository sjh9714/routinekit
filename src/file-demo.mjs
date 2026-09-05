import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { UpstreamMCP } from './upstream.mjs';
import { RoutineService } from './service.mjs';

// The CLI user explicitly selects the installed reference server. All sample
// writes and saved demo routines belong to a fresh disposable directory.
export async function prepareFileDemo(serverPath) {
  const executable = await realpath(resolve(serverPath));
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'routinekit-file-demo-')));
  const workspace = join(directory, 'workspace'); await mkdir(workspace);
  const upstream = new UpstreamMCP({ servers: { files: { command: process.execPath, args: [executable, workspace], tools: ['write_file','read_text_file'] } } });
  const service = new RoutineService({ root: join(directory, 'routines'), upstream });
  const close = async () => { await service.close(); await rm(directory, { recursive: true }); };
  try {
    await upstream.connect('files');
    const file = join(workspace, 'first-note.txt'); const content = 'First reusable note';
    service.recorder.begin({ name: 'write-and-check', inputs: { file, content }, tools: await upstream.tools() });
    for (const [name, args] of [['mcp:files:write_file', { path: file, content }], ['mcp:files:read_text_file', { path: file }]]) {
      const tool = await service.describe(name); const token = service.recorder.start(name);
      const result = await upstream.call(name, args, { contract: tool }); service.recorder.finish(token, name, args, result);
    }
    return { service, workspace, nextFile: join(workspace, 'second-note.txt'), close };
  } catch (error) { await close(); throw error; }
}
