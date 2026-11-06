import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './config.js';

export function readVersion() {
  let v = 'dev';
  try { v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { /* sin package.json */ }
  try {
    const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return `${v}+${git('rev-list', '--count', 'HEAD')}.${git('rev-parse', '--short', 'HEAD')}`;
  } catch { return v; }
}
