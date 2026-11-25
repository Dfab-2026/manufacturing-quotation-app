import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrationManifest, nodeSupported, releaseLockReady } from './release-policy.mjs';

// This is the ONLY command allowed to regenerate the frontend lockfile.
// It is an explicit, local maintenance operation; CI/Vercel use npm ci.
const npmCli = process.env.npm_execpath;
if (!nodeSupported(process.versions.node)) {
  console.error(`Use Node.js 22 or 24 LTS; found ${process.version}.`);
  process.exit(1);
}
if (!npmCli) {
  console.error('Run npm run release:prepare using npm (npm_execpath missing).');
  process.exit(1);
}
const cwd = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = new URL('../package.json', import.meta.url);
const lockPath = new URL('../package-lock.json', import.meta.url);
const originals = [manifestPath, lockPath].map(path => [path, readFileSync(path)]);
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
function npm(...args) {
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed (${result.status ?? result.signal})`);
}
try {
  const currentManifest = readJSON(manifestPath);
  const migratedManifest = migrationManifest(currentManifest);
  writeFileSync(manifestPath, JSON.stringify(migratedManifest, null, 2) + '\n');
  npm('install', '--package-lock-only', '--ignore-scripts', '--include=dev', '--no-audit', '--no-fund');
  if (!releaseLockReady(readJSON(manifestPath), readJSON(lockPath))) {
    throw new Error('Registry did not resolve a consistent, supported dependency graph.');
  }
  // A successful lock resolution is not enough: install and validate the exact
  // tree before users commit it. Any failure restores the original manifests.
  npm('run', 'release:check');
  console.log('Release checks passed. Commit frontend/package.json AND frontend/package-lock.json together.');
} catch (error) {
  for (const [path, original] of originals) writeFileSync(path, original);
  console.error(`Release NOT ready: ${error.message}\nOriginal manifests restored; do not publish until this command passes.`);
  process.exitCode = 1;
}
