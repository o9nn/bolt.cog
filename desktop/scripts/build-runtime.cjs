const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { build } = require('../../node_modules/esbuild');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(pnpm, ['exec', 'remix', 'vite:build', '--mode', 'desktop'], {
    cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  if (result.status !== 0) throw new Error('Remix desktop build failed');
  const runtime = path.join(root, 'desktop/runtime');
  fs.rmSync(runtime, { force: true, recursive: true });
  fs.mkdirSync(runtime, { recursive: true });
  fs.cpSync(path.join(root, 'build/client'), path.join(runtime, 'client'), { recursive: true });
  await build({ entryPoints: [path.join(root, 'desktop/backend-entry.ts')], outfile: path.join(runtime, 'backend.cjs'),
    platform: 'node', target: 'node22', format: 'cjs', bundle: true, sourcemap: false,
    alias: { 'react-dom/server': 'react-dom/server.browser' },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info' });
  fs.writeFileSync(path.join(runtime, 'manifest.json'), JSON.stringify({ runtime: 'node-local',
    app: require('../package.json').version, sourceDigest: require('./runtime-manifest.cjs').sourceDigest(root), builtAt: new Date().toISOString(), inferenceBundled: false }, null, 2) + '\n');
  if (!fs.existsSync(path.join(runtime, 'client/assets'))) throw new Error('Missing application assets');
  console.log('Local runtime payload ready; provider credentials and model weights are not included.');
})().catch((error) => { console.error(error.message); process.exit(1); });
