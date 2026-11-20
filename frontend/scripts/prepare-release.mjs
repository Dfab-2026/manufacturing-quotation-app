import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nodeSupported } from './release-policy.mjs';
const npmCli=process.env.npm_execpath;
if(!nodeSupported(process.versions.node)){console.error(`Use Node.js 22 or 24 LTS; found ${process.version}. Run npm run release:prepare after switching Node versions.`);process.exit(1);}
if(!npmCli){console.error('Run npm run release:prepare using npm (npm_execpath missing).');process.exit(1);}
const cwd=fileURLToPath(new URL('../',import.meta.url));
const originals=['package.json','package-lock.json'].map(name=>{const path=new URL('../'+name,import.meta.url);return [path,readFileSync(path)];});
function npm(...args){const result=spawnSync(process.execPath,[npmCli,...args],{cwd,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw new Error(`npm ${args.join(' ')} failed (${result.status ?? result.signal})`);}
try {
  npm('run','release:install');
  npm('run','release:check');
  console.log('Release checks passed. Commit package.json and the generated package-lock.json along with the project changes.');
} catch(error) {
  for(const [path,original] of originals)writeFileSync(path,original);
  console.error(`Release NOT ready: ${error.message}\nOriginal manifests restored. Run npm ci to restore the previous local installation; do not publish until release checks pass.`);
  process.exitCode=1;
}
