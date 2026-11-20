import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CHECKED_PACKAGES, TARGET_RUNTIME, TARGET_OVERRIDES, migrationManifest, supportedNext, supportedReact, releaseLockReady, nodeSupported } from '../scripts/release-policy.mjs';
const sourceManifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const seedManifest={...sourceManifest,dependencies:{...sourceManifest.dependencies,next:'^14.2.35',react:'^18.3.1','react-dom':'^18.3.1'},devDependencies:{...sourceManifest.devDependencies,'@types/react':'^18.3.12','@types/react-dom':'^18.3.1'}};
const versions={'next':'15.5.29','react':'19.3.1','react-dom':'19.3.1','@types/react':'19.2.0','@types/react-dom':'19.2.0','typescript':'5.9.3','occt-import-js':'0.0.23','three':'0.185.1','ag-grid-community':'32.3.9','ag-grid-react':'32.3.9','postcss':'8.5.33','sharp':'0.35.5'};
const makeLock=(manifest, overrides={})=>({lockfileVersion:3, packages:{'':{dependencies:manifest.dependencies,devDependencies:manifest.devDependencies},...Object.fromEntries(Object.entries({...versions,...overrides}).map(([k,v])=>[`node_modules/${k}`,{version:v}]))}});
test('deployment rejects the original unsupported release and invalid/prerelease versions',()=>{
  for (const version of ['14.2.35','15.5.28','16.4.4','15.5.29-canary.0','garbage','']) assert.equal(supportedNext(version),false,version);
  for (const version of ['15.5.29','16.4.5','16.5.0']) assert.equal(supportedNext(version),true,version);
  assert.equal(supportedReact('19.3.0'),false); assert.equal(supportedReact('19.2.8'),false); assert.equal(supportedReact('19.3.1'),true);
  assert.equal(nodeSupported('22.16.0'),true); assert.equal(nodeSupported('24.0.0'),true); assert.equal(nodeSupported('20.0.0'),false);
});
test('migration changes only the framework and React dependency entries',()=>{
  const migrated=migrationManifest(seedManifest);
  assert.deepEqual(migrated.scripts,seedManifest.scripts);
  for (const [name,version] of Object.entries(seedManifest.dependencies)) if(!(name in TARGET_RUNTIME)) assert.equal(migrated.dependencies[name],version);
  assert.equal(migrated.dependencies.next,'^15.5.29');
  assert.equal(migrated.dependencies.react,migrated.dependencies['react-dom']);
  assert.equal(migrated.devDependencies.typescript,seedManifest.devDependencies.typescript);
});
test('release lock policy rejects manifest drift, old React and mismatched React DOM',()=>{
  const manifest=migrationManifest(seedManifest);
  const lock=makeLock(manifest);
  assert.equal(releaseLockReady(manifest,lock),true);
  assert.equal(releaseLockReady(seedManifest,lock),false);
  assert.equal(releaseLockReady(manifest,makeLock(manifest,{'react-dom':'19.2.9'})),false);
  assert.equal(releaseLockReady(manifest,makeLock(manifest,{'react':'18.3.1','react-dom':'18.3.1'})),false);
  assert.equal(releaseLockReady(manifest,makeLock(manifest,{'@types/react':'18.3.31'})),false);
});
// Exercise the real release orchestration with an isolated simulated npm runner.
// This tests control flow and rollback, NOT availability of packages on npm.
function withFixture(fn){
  const dir=mkdtempSync(join(tmpdir(),'mq-release-test-'));
  try{
    mkdirSync(join(dir,'scripts'));
    for(const name of ['install-release.mjs','release-policy.mjs','check-release.mjs']) copyFileSync(new URL('../scripts/'+name,import.meta.url),join(dir,'scripts',name));
    const manifestPath=join(dir,'package.json'),lockPath=join(dir,'package-lock.json');
    const manifestBytes=JSON.stringify(seedManifest,null,2)+'\n';
    const lockBytes=JSON.stringify(makeLock(seedManifest,{next:'14.2.35',react:'18.3.1','react-dom':'18.3.1'}),null,2)+'\n';
    writeFileSync(manifestPath,manifestBytes);writeFileSync(lockPath,lockBytes);
    const stub=join(dir,'npm-runner.mjs');
    writeFileSync(stub,`import fs from 'node:fs';import path from 'node:path';
const [cmd,...args]=process.argv.slice(2);fs.appendFileSync('npm-calls.log',cmd+' '+args.join(' ')+'\\n');
if(process.env.FAIL_COMMAND===cmd) process.exit(9);
const versions=${JSON.stringify(versions)};
if(cmd==='install') {
 const m=JSON.parse(fs.readFileSync('package.json','utf8'));
 if(m.dependencies.next!=='^15.5.29'||m.dependencies.react!==m.dependencies['react-dom']||m.devDependencies['@types/react']!=='^19.0.0') process.exit(7);
 fs.writeFileSync('package-lock.json',JSON.stringify({lockfileVersion:3,packages:{'':{dependencies:m.dependencies,devDependencies:m.devDependencies},...Object.fromEntries(Object.entries(versions).map(([k,v])=>['node_modules/'+k,{version:v}]))}}));
} else if(cmd==='ci') {
 for(const name of ${JSON.stringify(CHECKED_PACKAGES)}) {const p=path.join('node_modules',name);fs.mkdirSync(p,{recursive:true});fs.writeFileSync(path.join(p,'package.json'),JSON.stringify({version:versions[name]}));}
 fs.mkdirSync('public/vendor/occt',{recursive:true});for(const name of ['occt-import-js.js','occt-import-js.wasm']) fs.writeFileSync('public/vendor/occt/'+name,'fixture');
} else process.exit(8);`);
    const run=(name,args=[],extra={})=>spawnSync(process.execPath,[join(dir,'scripts',name),...args],{cwd:dir,env:{...process.env,npm_execpath:stub,...extra},encoding:'utf8'});
    fn({dir,run,manifestPath,lockPath,manifestBytes,lockBytes,calls:()=>readFileSync(join(dir,'npm-calls.log'),'utf8').trim().split('\n')});
  } finally{rmSync(dir,{recursive:true,force:true});}
}
test('fresh V87 lock upgrades before gate, generates runtime, and does not reinstall on build',()=>withFixture(f=>{
  const run=f.run('install-release.mjs'); assert.equal(run.status,0,run.stderr);
  assert.equal(f.calls().length,2); assert.match(f.calls()[0],/^install .*--package-lock-only/); assert.match(f.calls()[1],/^ci /);
  assert.equal(f.run('check-release.mjs').status,0);
  assert.equal(f.run('install-release.mjs',['--if-needed']).status,0);
  assert.equal(f.calls().length,2);
  // Normal deploy with an already migrated lock uses npm ci without re-resolution.
  assert.equal(f.run('install-release.mjs').status,0); assert.equal(f.calls().length,3); assert.match(f.calls()[2],/^ci /);
}));
test('registry resolution failure restores the original manifest and lock and returns nonzero',()=>withFixture(f=>{
  const run=f.run('install-release.mjs',[],{FAIL_COMMAND:'install'});assert.notEqual(run.status,0);
  assert.equal(readFileSync(f.manifestPath,'utf8'),f.manifestBytes);assert.equal(readFileSync(f.lockPath,'utf8'),f.lockBytes);assert.equal(f.run('check-release.mjs').status,1);
}));
test('failed npm ci after upgrade restores both files; no partial release can pass',()=>withFixture(f=>{
  const run=f.run('install-release.mjs',[],{FAIL_COMMAND:'ci'});assert.notEqual(run.status,0);
  assert.equal(readFileSync(f.manifestPath,'utf8'),f.manifestBytes);assert.equal(readFileSync(f.lockPath,'utf8'),f.lockBytes);
}));
test('Vercel and ordinary builds use the installer and keep real build and audit checks',()=>{
  const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.equal(config.installCommand,'npm run release:install');assert.equal(config.buildCommand,'npm run release:check');
  assert.equal(sourceManifest.scripts.build,'npm run release:check');
  assert.equal(sourceManifest.scripts['release:check'],'node scripts/run-release-check.mjs');
  const runner=readFileSync(new URL('../scripts/run-release-check.mjs',import.meta.url),'utf8');
  for(const check of ['install-release.mjs','--if-needed','check-release.mjs','node_modules/next/dist/bin/next','node_modules/typescript/bin/tsc','--noEmit','--audit-level=high']) assert.ok(runner.includes(check),check);
  assert.equal(sourceManifest.type,'module');
});

test('Vercel runtime is pinned in both manifests and both lockfile roots',()=>{
  for(const base of ['../','../../']) {
    const manifest=JSON.parse(readFileSync(new URL(base+'package.json',import.meta.url),'utf8'));
    const lock=JSON.parse(readFileSync(new URL(base+'package-lock.json',import.meta.url),'utf8'));
    assert.equal(manifest.engines.node,'22.x');
    assert.equal(lock.packages[''].engines.node,'22.x');
  }
  assert.equal(readFileSync(new URL('../../.nvmrc',import.meta.url),'utf8').trim(),'22');
});
test('installer distinguishes missing npm lifecycle from a Node version failure',()=>withFixture(f=>{
  const run=f.run('install-release.mjs',[],{npm_execpath:''});
  assert.equal(run.status,1); assert.match(run.stdout,/Release runtime: Node.js v/);
  assert.match(run.stderr,/npm_execpath missing/);
  assert.equal(readFileSync(f.manifestPath,'utf8'),f.manifestBytes);
}));


test('release rejects outdated transitive CSS and image processing packages, including nested copies',()=>{
  const manifest=migrationManifest(seedManifest);
  assert.deepEqual(manifest.overrides,TARGET_OVERRIDES);
  assert.equal(releaseLockReady(manifest,makeLock(manifest,{'postcss':'8.4.31'})),false);
  assert.equal(releaseLockReady(manifest,makeLock(manifest,{'sharp':'0.34.5'})),false);
  const lock=makeLock(manifest);
  lock.packages['node_modules/next/node_modules/postcss']={version:'8.5.18'};
  assert.equal(releaseLockReady(manifest,lock),false);
  assert.equal(releaseLockReady({...manifest,overrides:{}},makeLock(manifest)),false);
});

test('release runner identifies the failing command and never reports a false pass',()=>{
  const dir=mkdtempSync(join(tmpdir(),'mq-release-runner-'));
  try {
    mkdirSync(join(dir,'scripts'));
    for(const name of ['run-release-check.mjs','release-policy.mjs']) copyFileSync(new URL('../scripts/'+name,import.meta.url),join(dir,'scripts',name));
    const stub="import {appendFileSync} from 'node:fs'; const args=process.argv.slice(2); appendFileSync('calls.log',args.join(' ')+'\\n'); if(process.env.BAD_STAGE && args.includes(process.env.BAD_STAGE)) process.exit(17);";
    for(const name of ['install-release','check-release']) writeFileSync(join(dir,'scripts',name+'.mjs'),stub);
    for(const name of ['next/dist/bin/next','typescript/bin/tsc']) {const path=join(dir,'node_modules',name);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,stub);}
    const npm=join(dir,'npm.mjs');writeFileSync(npm,stub);
    const run=bad=>spawnSync(process.execPath,[join(dir,'scripts','run-release-check.mjs')],{cwd:dir,env:{...process.env,npm_execpath:npm,BAD_STAGE:bad},encoding:'utf8'});
    const failed=run('audit');assert.equal(failed.status,17);assert.match(failed.stderr,/FAILED 6\/8.*vulnerability audit/i);assert.doesNotMatch(failed.stdout,/All release checks passed/);
    const buildFailed=run('build');assert.equal(buildFailed.status,17);assert.match(buildFailed.stderr,/FAILED 7\/8.*production build/i);
    const passed=run('');assert.equal(passed.status,0,passed.stderr);assert.match(passed.stdout,/All release checks passed/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
