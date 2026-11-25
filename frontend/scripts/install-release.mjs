import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CHECKED_PACKAGES, lockVersion, nodeSupported, releaseLockReady } from './release-policy.mjs';

// Normal/local releases install exactly the checked-in lockfile. Vercel has a
// narrowly scoped recovery path for a stale lock paired with an already pinned
// and supported manifest; the regenerated lock is revalidated before npm ci.
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
  let lock = readJSON(new URL('../package-lock.json', import.meta.url));
  if (!releaseLockReady(manifest, lock)) {
    const isVercelBuild = process.env.VERCEL === '1' || ['production', 'preview', 'development'].includes(process.env.VERCEL_ENV || '');
    if (isVercelBuild) {
      console.warn('Committed frontend lockfile is stale for the pinned release manifest. Regenerating it only inside the Vercel build workspace, then revalidating before install.');
      npm('install', '--package-lock-only', '--ignore-scripts', '--include=dev', '--no-audit', '--no-fund');
      lock = readJSON(new URL('../package-lock.json', import.meta.url));
      if (!releaseLockReady(manifest, lock)) {
        throw new Error('Vercel lockfile recovery did not produce a supported dependency graph. Run npm run release:prepare locally and commit BOTH frontend/package.json and frontend/package-lock.json.');
      }
      console.warn('Vercel lockfile recovery succeeded. Commit the regenerated frontend/package-lock.json locally to make future deployments fully deterministic.');
    } else {
      throw new Error('The committed package.json and package-lock.json do not meet the release policy. Run npm run release:prepare locally, verify it passes, and commit BOTH files together.');
    }
  }
  if (!process.argv.includes('--if-needed') || !runtimeReady(lock)) {
    npm('ci', '--include=dev', '--no-audit', '--no-fund');
  }
  if (!runtimeReady(lock)) throw new Error('Installed dependencies or CAD assets differ from the validated lockfile.');
  console.log(`Release dependencies ready from validated lockfile: Next.js ${lockVersion(lock, 'next')}, React ${lockVersion(lock, 'react')}.`);
} catch (error) {
  console.error(`Release install failed: ${error.message}`);
  process.exitCode = 1;
}
