import { copyFile, mkdir, access } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "node_modules", "occt-import-js", "dist");
const target = path.join(root, "public", "vendor", "occt");

await mkdir(target, { recursive: true });
for (const name of ["occt-import-js.js", "occt-import-js.wasm"]) {
  const from = path.join(source, name);
  await access(from);
  await copyFile(from, path.join(target, name));
}
console.log("CAD runtime copied to public/vendor/occt");
