import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Security floors from the November 3, 2026 Next.js release. npm audit must
// also pass because this baseline does not cover subsequently issued advisories.
const version = require('next/package.json').version;
const [major, minor, patch] = version.split('.').map(Number);
const supported = !version.includes('-') && (
  (major === 15 && (minor > 5 || (minor === 5 && patch >= 29))) ||
  (major === 16 && (minor > 4 || (minor === 4 && patch >= 5)))
);
if (!supported) {
  console.error(`Release blocked: Next.js ${version} is below the supported security baseline. Run npm run release:prepare.`);
  process.exit(1);
}
const locked = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
if (locked.packages?.['node_modules/next']?.version !== version) {
  console.error('Release blocked: installed Next.js does not match package-lock.json. Run npm ci.');
  process.exit(1);
}
console.log(`Next.js ${version}: release version and lockfile check passed.`);
