import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function files(directory) {
  return readdirSync(directory).flatMap(name => {
    const filename = `${directory}/${name}`;
    return statSync(filename).isDirectory() ? files(filename) : [filename];
  });
}

const artifacts = files('dist');
const prohibited = [/JEV_API_KEY/, /CLOUDFLARE_API_TOKEN/, /api\.typesafe\.ai/, /sk-[A-Za-z0-9_-]{24,}/, /BEGIN (?:RSA )?PRIVATE KEY/];
for (const filename of artifacts.filter(filename => /\.(?:js|html|json|css|map)$/.test(filename))) {
  const content = readFileSync(filename, 'utf8');
  assert(!prohibited.some(pattern => pattern.test(content)), `Server-only data detected in ${filename}`);
}
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
assert(!tracked.some(filename => /(?:^|\/)(?:node_modules|\.wrangler|runtime|\.env(?:\.|$)|\.dev\.vars)/.test(filename)), 'Private or generated files staged');
assert(!artifacts.some(filename => filename.endsWith('.map')), 'Production source maps must not be published');
console.log(JSON.stringify({ check: 'release-boundary', passed: true, builtFiles: artifacts.length, trackedFiles: tracked.length }));
