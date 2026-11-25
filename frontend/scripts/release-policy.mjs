// A single version policy shared by install, build and regression tests.
// Do not weaken this floor to make an outdated lockfile deploy.
export const TARGET_RUNTIME = Object.freeze({ next: '^15.5.29', react: '19.3.1', 'react-dom': '19.3.1' });
export const TARGET_OVERRIDES = Object.freeze({ postcss: '^8.5.23', sharp: '^0.35.5' });
export const TARGET_TYPES = Object.freeze({ '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0' });
const versionParts = value => /^\d+\.\d+\.\d+$/.test(String(value)) ? String(value).split('.').map(Number) : [];
export function supportedNext(value) {
  const [major, minor, patch] = versionParts(value);
  return (major === 15 && (minor > 5 || (minor === 5 && patch >= 29))) ||
    (major === 16 && (minor > 4 || (minor === 4 && patch >= 5)));
}
export function supportedReact(value) {
  const [major, minor, patch] = versionParts(value);
  return major === 19 && (minor > 3 || (minor === 3 && patch >= 1) || (minor === 2 && patch >= 9) || (minor === 1 && patch >= 10) || (minor === 0 && patch >= 9));
}
export function supportedPostcss(value) {
  const [major, minor, patch] = versionParts(value);
  return major === 8 && (minor > 5 || (minor === 5 && patch >= 23));
}
export function supportedSharp(value) {
  const [major, minor, patch] = versionParts(value);
  return major === 0 && (minor > 35 || (minor === 35 && patch >= 5));
}
function safeTransitive(lock, name, supported, required) {
  const entries = Object.entries(lock?.packages || {}).filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`));
  return (!required || entries.length > 0) && entries.every(([, entry]) => supported(entry.version));
}
export function nodeSupported(value) {
  return [22, 24].includes(Number(String(value).split('.')[0]));
}
export function lockVersion(lock, name) { return lock?.packages?.[`node_modules/${name}`]?.version || ''; }
export const CHECKED_PACKAGES = ['next', 'react', 'react-dom', '@types/react', '@types/react-dom', 'typescript', 'occt-import-js', 'ag-grid-community', 'ag-grid-react', 'three'];
export function releaseLockReady(manifest, lock) {
  if (lock?.lockfileVersion !== 3 || lock?.name !== manifest?.name || lock?.version !== manifest?.version) return false;
  const rootMetadata = lock?.packages?.[''];
  if (rootMetadata?.name !== manifest?.name || rootMetadata?.version !== manifest?.version ||
      rootMetadata?.engines?.node !== manifest?.engines?.node) return false;
  const react = lockVersion(lock, 'react');
  if (!supportedNext(lockVersion(lock, 'next')) || !supportedReact(react) || react !== lockVersion(lock, 'react-dom')) return false;
  if (!['@types/react', '@types/react-dom'].every(name => versionParts(lockVersion(lock,name))[0] === 19)) return false;
  if (!Object.entries(TARGET_OVERRIDES).every(([name, range]) => manifest?.overrides?.[name] === range)) return false;
  if (!safeTransitive(lock, 'postcss', supportedPostcss, true) || !safeTransitive(lock, 'sharp', supportedSharp, false)) return false;
  const root = lock?.packages?.[''];
  if (!root) return false;
  // npm ci verifies the full graph. This early check also catches manifest drift.
  for (const group of ['dependencies', 'devDependencies']) {
    const expected = manifest?.[group] || {}, actual = root[group] || {};
    if (Object.keys(expected).length !== Object.keys(actual).length || Object.entries(expected).some(([k,v]) => actual[k] !== v)) return false;
  }
  return true;
}
export function migrationManifest(manifest) {
  return { ...manifest, dependencies: { ...manifest.dependencies, ...TARGET_RUNTIME }, devDependencies: { ...manifest.devDependencies, ...TARGET_TYPES }, overrides: { ...manifest.overrides, ...TARGET_OVERRIDES } };
}
