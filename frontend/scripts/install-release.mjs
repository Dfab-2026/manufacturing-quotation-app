import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CHECKED_PACKAGES, lockVersion, nodeSupported, releaseLockReady, migrationManifest } from './release-policy.mjs';

// Vercel runs this on a fresh checkout; local release:prepare uses the same path.
// The checked-in V87 lockfile is only a migration seed until a real npm install
// resolves the supported packages. Never synthesize lockfile integrity fields.
const cwd = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = new URL('../package.json', import.meta.url);
const lockPath = new URL('../package-lock.json', import.meta.url);
const npmCli = process.env.npm_execpath;
if (!npmCli || !nodeSupported(process.versions.node)) {
  console.error('Release requires Node.js 22 or 24 LTS. Run npm run release:install.');
  process.exit(1);
}
const originals = [manifestPath, lockPath].map(path=>[path, readFileSync(path)]);
const readJSON = path=>JSON.parse(readFileSync(path,'utf8'));
function npm(...args) {
  const result=spawnSync(process.execPath,[npmCli,...args],{cwd,stdio:'inherit',env:{...process.env}});
  if(result.error) throw result.error;
  if(result.status!==0) throw new Error(`npm ${args.join(' ')} failed (${result.status ?? result.signal})`);
}
function runtimeReady(lock) {
  return CHECKED_PACKAGES.every(name=>{
    try { return readJSON(new URL(`../node_modules/${name}/package.json`,import.meta.url)).version===lockVersion(lock,name); }
    catch { return false; }
  }) && ['occt-import-js.js','occt-import-js.wasm'].every(name=>existsSync(new URL(`../public/vendor/occt/${name}`,import.meta.url)));
}
try {
  let manifest=readJSON(manifestPath), lock=readJSON(lockPath);
  if(!releaseLockReady(manifest,lock)) {
    console.log('Preparing supported Next.js / React dependencies before the release gate.');
    const migrated=migrationManifest(manifest);
    writeFileSync(manifestPath,JSON.stringify(migrated,null,2)+'\n');
    // Resolve all runtime and type packages in one operation (no React peer mismatch).
    npm('install','--package-lock-only','--ignore-scripts','--include=dev','--no-audit','--no-fund');
    manifest=readJSON(manifestPath); lock=readJSON(lockPath);
    if(!releaseLockReady(manifest,lock)) throw new Error('Registry returned an unsupported or inconsistent release lockfile.');
  }
  if(!process.argv.includes('--if-needed') || !runtimeReady(lock)) npm('ci','--include=dev','--no-audit','--no-fund');
  if(!runtimeReady(lock)) throw new Error('Installed runtime or CAD assets do not match the release lockfile.');
  console.log(`Release dependencies ready: Next.js ${lockVersion(lock,'next')}, React ${lockVersion(lock,'react')}.`);
} catch(error) {
  for(const [path,original] of originals) writeFileSync(path,original);
  console.error(`Release install failed: ${error.message}\nOriginal manifests restored; do not deploy until this command passes.`);
  process.exitCode=1;
}
