import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CHECKED_PACKAGES, lockVersion, nodeSupported, releaseLockReady } from './release-policy.mjs';

// A deployment must install *exactly* the checked-in lockfile. It must never
// rewrite package.json or resolve new versions during a Vercel/CI build.
const cwd = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
console.log(`Release runtime: Node.js ${process.version} (${process.platform}/${process.arch}).`);
if (!nodeSupported(process.versions.node)) {
  console.error(`Release requires Node.js 22 or 24 LTS; found ${process.version}. Vercel: use Node.js 22.x.`);
  process.exit(1);
}
if (!npmCli) {
  console.error('Release requires the npm lifecycle environment (npm_execpath missing). Invoke npm run release:install using npm, not node directly.');
  process.exit(1);
}
function npm(...args) {
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed (${result.status ?? result.signal})`);
}
function runtimeReady(lock) {
  return CHECKED_PACKAGES.every(name => {
    try { return readJSON(new URL(`../node_modules/${name}/package.json`, import.meta.url)).version === lockVersion(lock, name); }
    catch { return false; }
  }) && ['occt-import-js.js', 'occt-import-js.wasm'].every(name =>
    existsSync(new URL(`../public/vendor/occt/${name}`, import.meta.url)));
}
try {
  const manifest = readJSON(new URL('../package.json', import.meta.url));
  const lock = readJSON(new URL('../package-lock.json', import.meta.url));
  if (!releaseLockReady(manifest, lock)) {
    throw new Error('The committed package.json and package-lock.json do not meet the release policy. On an internet-connected machine, run npm run release:prepare once, verify the result, and commit BOTH files together. Deployment will not regenerate a lockfile.');
  }
  if (!process.argv.includes('--if-needed') || !runtimeReady(lock)) {
    npm('ci', '--include=dev', '--no-audit', '--no-fund');
  }
  if (!runtimeReady(lock)) throw new Error('Installed dependencies or CAD assets differ from the committed lockfile.');
  console.log(`Release dependencies ready from committed lockfile: Next.js ${lockVersion(lock, 'next')}, React ${lockVersion(lock, 'react')}.`);
} catch (error) {
  console.error(`Release install failed: ${error.message}`);
  process.exitCode = 1;
}
