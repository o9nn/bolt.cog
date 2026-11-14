'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { sourceDigest } = require('./runtime-manifest.cjs');
module.exports = async function beforePack(context) {
  const root = path.resolve(context.packager.projectDir, '..');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'desktop/runtime/manifest.json'), 'utf8')); }
  catch { throw new Error('Build the local runtime with pnpm run build:desktop before packaging'); }
  const version = require(path.join(root, 'desktop/package.json')).version;
  if (manifest.app !== version || manifest.sourceDigest !== sourceDigest(root) || manifest.runtime !== 'node-local') {
    throw new Error('Local runtime is stale. Run pnpm run build:desktop before packaging this source/version.');
  }
};
