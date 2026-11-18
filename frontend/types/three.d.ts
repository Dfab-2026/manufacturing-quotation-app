// Three.js is consumed as a browser-only runtime library by ModelViewer.
// Keep the Vercel type-check deterministic even when the optional upstream
// @types/three package is not available in the install cache.
declare module "three";
