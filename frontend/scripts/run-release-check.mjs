import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {nodeSupported} from './release-policy.mjs';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
// Keep CI and Vercel on the same fail-closed validation path. Passing a unit
// test must not hide a later type, bundler, or vulnerability failure.
if (!nodeSupported(process.versions.node) || !npmCli) {
  console.error(`[release] Run npm run release:check using Node.js 22 or 24 LTS (found ${process.version}; npm lifecycle ${npmCli ? 'available' : 'missing'}).`);
  process.exit(1);
}
const steps = [
  ['Dependency installation and lockfile preparation', process.execPath, ['scripts/install-release.mjs','--if-needed']],
  ['Installed dependency verification', process.execPath, ['scripts/check-release.mjs']],
  ['Release orchestration regression tests', process.execPath, [npmCli,'run','test:release']],
  ['Drawing locator regression tests', process.execPath, [npmCli,'run','test:locator']],
  ['API routing regression tests', process.execPath, [npmCli,'run','test:routing']],
  ['Dependency vulnerability audit', process.execPath, [npmCli,'audit','--audit-level=high']],
  ['Next.js production build (includes framework type and lint checks)', process.execPath, ['node_modules/next/dist/bin/next','build']],
  ['Final TypeScript check', process.execPath, ['node_modules/typescript/bin/tsc','--noEmit']],
];
for (const [index,[name,command,args]] of steps.entries()) {
  console.log(`\n[release ${index+1}/${steps.length}] ${name} — START`);
  const child = spawnSync(command,args,{cwd,stdio:'inherit',env:process.env});
  if (child.error || child.status !== 0) {
    console.error(`[release FAILED ${index+1}/${steps.length}] ${name}: ${child.error?.message || `exit ${child.status ?? child.signal}`}`);
    console.error('[release] The actual error is above this line. No subsequent release checks were skipped as successful.');
    process.exit(Number.isInteger(child.status) && child.status > 0 ? child.status : 1);
  }
  console.log(`[release ${index+1}/${steps.length}] ${name} — PASSED`);
}
console.log('\n[release] All release checks passed.');
