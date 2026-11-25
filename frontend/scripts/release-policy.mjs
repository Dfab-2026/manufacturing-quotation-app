// Release policy intentionally follows the application's committed framework
// generation. CI/Vercel must install the checked-in lockfile exactly and must
// not force a framework-major migration during deployment.
export const TARGET_RUNTIME = Object.freeze({ next: '16.4.6', react: '19.3.1', 'react-dom': '19.3.1' });
export const TARGET_OVERRIDES = Object.freeze({});
export const TARGET_TYPES = Object.freeze({ '@types/react': '19.3.0', '@types/react-dom': '19.3.0' });
const versionParts = value => /^\d+\.\d+\.\d+$/.test(String(value)) ? String(value).split('.').map(Number) : [];
export function supportedNext(value) {
  const [major, minor, patch] = versionParts(value);
  return major === 16 && (minor > 4 || (minor === 4 && patch >= 6));
}
export function supportedReact(value) {
  const [major, minor, patch] = versionParts(value);
  return major === 19 && (minor > 3 || (minor === 3 && patch >= 1));
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
  const root = lock?.packages?.[''];
  if (!root) return false;
  // npm ci verifies the full graph. This early check catches manifest/lock drift
  // without contacting the registry or rewriting dependency files.
  for (const group of ['dependencies', 'devDependencies']) {
    const expected = manifest?.[group] || {}, actual = root[group] || {};
    if (Object.keys(expected).length !== Object.keys(actual).length || Object.entries(expected).some(([k,v]) => actual[k] !== v)) return false;
  }
  return true;
}
export function migrationManifest(manifest) {
  return { ...manifest, dependencies: { ...manifest.dependencies, ...TARGET_RUNTIME }, devDependencies: { ...manifest.devDependencies, ...TARGET_TYPES } };
}
