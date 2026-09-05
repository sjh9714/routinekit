import { readFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const server = JSON.parse(await readFile('server.json', 'utf8'));
if (server.name !== pkg.mcpName || server.version !== pkg.version || server.packages[0].version !== pkg.version || server.packages[0].identifier !== pkg.name || server.packages[0].packageArguments[0].value !== 'mcp') throw new Error('Registry metadata does not match the package.');
const response = await fetch(`https://registry.npmjs.org/${pkg.name}/${pkg.version}`);
if (!response.ok) throw new Error('Publish the exact npm version first.');
const published = await response.json();
if (published.mcpName !== server.name || published.version !== pkg.version) throw new Error('Published npm identity mismatch.');
console.log(`Verified published ${pkg.name}@${pkg.version} for ${server.name}.`);
