import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

let commit = 'uncommitted';
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
mkdirSync('worker/generated', { recursive: true });
writeFileSync('worker/generated/build.ts', `export const BUILD = ${JSON.stringify({ commit, dirty, version: '1.0.0' })} as const;\n`);
execFileSync('npx', ['vite', 'build'], { stdio: 'inherit' });
writeFileSync('dist/source.json', JSON.stringify({ commit, dirty, version: '1.0.0' }));
