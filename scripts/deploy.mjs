import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const run = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (run('status', '--porcelain')) throw new Error('Deploy requires a clean, committed worktree.');
const commit = run('rev-parse', 'HEAD');
if (run('branch', '--show-current') !== 'main') throw new Error('Deploy only from tested main.');
const remote = run('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0];
if (remote !== commit) throw new Error('GitHub main must equal HEAD before deploy.');
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
const source = JSON.parse(readFileSync('dist/source.json', 'utf8'));
if (source.commit !== commit || source.dirty) throw new Error('Build identity mismatch.');
execFileSync('npx', ['wrangler', 'deploy', '--tag', commit.slice(0, 12), '--message', `source ${commit}`], { stdio: 'inherit' });
