import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Run from npm, using the same npm executable on Windows, Linux and macOS.
const npmCli = process.env.npm_execpath;
if (!npmCli || ![22,24].includes(Number(process.versions.node.split('.')[0]))) {
  console.error('Use Node.js 22 or 24 LTS and start with npm run release:prepare.');
  process.exit(1);
}
const cwd = fileURLToPath(new URL('../', import.meta.url));
const manifests = ['package.json','package-lock.json'].map(name => {
  const path = new URL('../' + name, import.meta.url);
  return [path, readFileSync(path)];
});
function npm(...args) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {cwd, stdio:'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed (${result.status ?? result.signal})`);
}
try {
  // Maintenance LTS is the smallest supported move from existing Next 14;
  // install the newest security-patched releases from the selected majors.
  npm('install','--save-exact','next@15','react@19','react-dom@19');
  npm('install','--save-dev','--save-exact','@types/react@19','@types/react-dom@19');
  npm('ci');
  npm('run','release:check');
  console.log('\nRelease checks passed. Commit both package.json and package-lock.json with the updated source.');
} catch (error) {
  for (const [path, original] of manifests) writeFileSync(path, original);
  console.error(`\nRelease NOT ready: ${error.message}\nOriginal manifests restored. Run npm ci to restore installed dependencies before continuing local V87 usage.`);
  process.exitCode = 1;
}
