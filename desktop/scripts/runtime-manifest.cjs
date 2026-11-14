'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
function sourceDigest(root) {
  const hash = createHash('sha256');
  const ignore = new Set(['node_modules', 'runtime', 'dist', 'smoke-output', '.git']);
  function walk(relative) {
    const full = path.join(root, relative);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error('Source payload symlinks are not permitted');
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) {
        if (!ignore.has(name) && !name.startsWith('.env') && name !== '.DS_Store') walk(path.join(relative, name));
      }
    } else if (stat.isFile()) { hash.update(relative.replace(/\\/g, '/')); hash.update('\0'); hash.update(fs.readFileSync(full)); hash.update('\0'); }
  }
  for (const source of ['app', 'public', 'desktop', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'load-context.ts', 'worker-configuration.d.ts']) walk(source);
  return hash.digest('hex');
}
module.exports = { sourceDigest };
