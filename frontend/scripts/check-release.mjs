import { readFileSync } from 'node:fs';
import { CHECKED_PACKAGES, lockVersion, nodeSupported, releaseLockReady } from './release-policy.mjs';
const readJSON = path=>JSON.parse(readFileSync(path,'utf8'));
try {
  const manifest=readJSON(new URL('../package.json',import.meta.url));
  const lock=readJSON(new URL('../package-lock.json',import.meta.url));
  if(!nodeSupported(process.versions.node)) throw new Error(`Use Node.js 22 or 24 LTS; found ${process.version}.`);
  if(!releaseLockReady(manifest,lock)) throw new Error('Unsupported or inconsistent dependency lock. Run npm run release:install.');
  for(const name of CHECKED_PACKAGES) {
    const version=readJSON(new URL(`../node_modules/${name}/package.json`,import.meta.url)).version;
    if(version!==lockVersion(lock,name)) throw new Error(`${name} does not match package-lock.json. Run npm run release:install.`);
  }
  console.log(`Next.js ${lockVersion(lock,'next')}: dependency security baseline and lockfile check passed.`);
} catch(error){ console.error(`Release blocked: ${error.message}`); process.exitCode=1; }
