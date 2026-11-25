import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CHECKED_PACKAGES, TARGET_RUNTIME, TARGET_OVERRIDES, migrationManifest, supportedNext, supportedReact, releaseLockReady, nodeSupported } from '../scripts/release-policy.mjs';
const sourceManifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const seedManifest={...sourceManifest,dependencies:{...sourceManifest.dependencies,next:'^14.2.35',react:'^18.3.1','react-dom':'^18.3.1'},devDependencies:{...sourceManifest.devDependencies,'@types/react':'^18.3.12','@types/react-dom':'^18.3.1'}};
const versions={'next':'15.5.29','react':'19.3.1','react-dom':'19.3.1','@types/react':'19.2.0','@types/react-dom':'19.2.0','typescript':'5.9.3','occt-import-js':'0.0.23','three':'0.185.1','ag-grid-community':'32.3.9','ag-grid-react':'32.3.9','postcss':'8.5.33','sharp':'0.35.5'};
const makeLock=(manifest, overrides={})=>({name:manifest.name,version:manifest.version,lockfileVersion:3, packages:{'':{name:manifest.name,version:manifest.version,engines:manifest.engines,dependencies:manifest.dependencies,devDependencies:manifest.devDependencies},...Object.fromEntries(Object.entries({...versions,...overrides}).map(([k,v])=>[`node_modules/${k}`,{version:v}]))}});
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
  assert.equal(releaseLockReady(manifest,{...lock,name:'not-the-app'}),false);
  assert.equal(releaseLockReady(manifest,{...lock,lockfileVersion:2}),false);
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
    for(const name of ['install-release.mjs','prepare-release.mjs','release-policy.mjs','check-release.mjs']) copyFileSync(new URL('../scripts/'+name,import.meta.url),join(dir,'scripts',name));
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
 fs.writeFileSync('package-lock.json',JSON.stringify({name:m.name,version:m.version,lockfileVersion:3,packages:{'':{name:m.name,version:m.version,engines:m.engines,dependencies:m.dependencies,devDependencies:m.devDependencies},...Object.fromEntries(Object.entries(versions).map(([k,v])=>['node_modules/'+k,{version:v}]))}}));
} else if(cmd==='ci') {
 for(const name of ${JSON.stringify(CHECKED_PACKAGES)}) {const p=path.join('node_modules',name);fs.mkdirSync(p,{recursive:true});fs.writeFileSync(path.join(p,'package.json'),JSON.stringify({version:versions[name]}));}
 fs.mkdirSync('public/vendor/occt',{recursive:true});for(const name of ['occt-import-js.js','occt-import-js.wasm']) fs.writeFileSync('public/vendor/occt/'+name,'fixture');
} else if(cmd==='run' && args[0]==='release:check') {
 const cp=await import('node:child_process');
 for(const [script,scriptArgs] of [['install-release.mjs',['--if-needed']],['check-release.mjs',[]]]){
   const result=cp.spawnSync(process.execPath,[path.join('scripts',script),...scriptArgs],{env:{...process.env,npm_execpath:process.argv[1]},stdio:'pipe',encoding:'utf8'});
   if(result.status!==0){process.stderr.write(result.stderr || result.stdout);process.exit(result.status || 8);}
 }
} else process.exit(8);`);
    const run=(name,args=[],extra={})=>spawnSync(process.execPath,[join(dir,'scripts',name),...args],{cwd:dir,env:{...process.env,npm_execpath:stub,...extra},encoding:'utf8'});
    fn({dir,run,manifestPath,lockPath,manifestBytes,lockBytes,existsCalls:()=>existsSync(join(dir,'npm-calls.log')),calls:()=>readFileSync(join(dir,'npm-calls.log'),'utf8').trim().split('\n')});
  } finally{rmSync(dir,{recursive:true,force:true});}
}
test('a fresh deployment rejects the stale committed lock without modifying any manifest',()=>withFixture(f=>{
  const run=f.run('install-release.mjs');
  assert.equal(run.status,1);
  assert.match(run.stderr,/committed package.json and package-lock.json/);
  assert.equal(readFileSync(f.manifestPath,'utf8'),f.manifestBytes);
  assert.equal(readFileSync(f.lockPath,'utf8'),f.lockBytes);
  assert.equal(f.existsCalls(),false, 'installer must not contact npm or attempt migration');
}));
test('explicit local preparation resolves the graph, validates it, and makes later deployments npm-ci-only',()=>withFixture(f=>{
  const prepared=f.run('prepare-release.mjs');assert.equal(prepared.status,0,prepared.stderr);
  assert.deepEqual(f.calls().map(v=>v.split(' ')[0]),['install','run','ci']);
  assert.match(f.calls()[0],/^install .*--package-lock-only/);
  assert.equal(f.run('check-release.mjs').status,0);
  assert.equal(f.run('install-release.mjs',['--if-needed']).status,0);
  assert.equal(f.calls().length,3, 'build reuses an installed matching lock');
  assert.equal(f.run('install-release.mjs').status,0);
  assert.equal(f.calls().length,4);
  assert.match(f.calls()[3],/^ci /);
  assert.ok(f.calls().every(v=>!/^install /.test(v) || v===f.calls()[0]), 'release installer never re-resolves');
}));
test('offline registry failure restores both files during explicit preparation',()=>withFixture(f=>{
  const run=f.run('prepare-release.mjs',[],{FAIL_COMMAND:'install'});assert.notEqual(run.status,0);
  assert.equal(readFileSync(f.manifestPath,'utf8'),f.manifestBytes);
  assert.equal(readFileSync(f.lockPath,'utf8'),f.lockBytes);
}));
test('failed installation after explicit lock resolution restores both files',()=>withFixture(f=>{
  const run=f.run('prepare-release.mjs',[],{FAIL_COMMAND:'ci'});assert.notEqual(run.status,0);
  assert.equal(readFileSync(f.manifestPath,'utf8'),f.manifestBytes);
  assert.equal(readFileSync(f.lockPath,'utf8'),f.lockBytes);
}));
test('build-time npm-ci failure returns nonzero without rewriting the committed lockfile',()=>withFixture(f=>{
  const prepared=f.run('prepare-release.mjs');assert.equal(prepared.status,0,prepared.stderr);
  const beforeManifest=readFileSync(f.manifestPath,'utf8'),beforeLock=readFileSync(f.lockPath,'utf8');
  const run=f.run('install-release.mjs',[],{FAIL_COMMAND:'ci'});
  assert.equal(run.status,1);
  assert.equal(readFileSync(f.manifestPath,'utf8'),beforeManifest);
  assert.equal(readFileSync(f.lockPath,'utf8'),beforeLock);
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

// Vercel project audits: these tests inspect deployment configuration only.
// They do not alter the application UI, API routing or quotation workflow.
test('Vercel points to the existing frontend application without an output override', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const frontend = new URL('../', import.meta.url);
  assert.equal(config.framework, 'nextjs');
  assert.equal(config.installCommand, 'npm run release:install');
  assert.equal(config.buildCommand, sourceManifest.scripts.build === 'npm run release:check'
    ? 'npm run release:check' : 'npm run build');
  assert.ok(!Object.hasOwn(config, 'outputDirectory'), 'Next.js must own the build output');
  assert.ok(!Object.hasOwn(config, 'builds'), 'legacy Vercel builders must not override Next.js');
  for (const file of ['package.json', 'package-lock.json', 'app/page.tsx', 'next.config.mjs']) {
    assert.ok(existsSync(new URL(file, frontend)), `frontend project root missing ${file}`);
  }
  assert.equal(sourceManifest.engines.node, '22.x');
});

test('Vercel legacy backend-api rewrite uses the intended server-side backend origin', () => {
  const configFileUrl = new URL('../next.config.mjs', import.meta.url).href;
  const inspect = fastApiUrl => {
    const env = { ...process.env, VERCEL: '1' };
    if (fastApiUrl === undefined) delete env.FASTAPI_INTERNAL_URL;
    else env.FASTAPI_INTERNAL_URL = fastApiUrl;
    const child = spawnSync(process.execPath, [
      '--input-type=module', '--eval',
      `import cfg from ${JSON.stringify(configFileUrl)}; console.log(JSON.stringify(await cfg.rewrites()));`
    ], { env, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  };
  assert.deepEqual(inspect(undefined), [{
    source: '/backend-api/:path*',
    destination: 'https://ai-quotation-api.onrender.com/:path*'
  }]);
  assert.deepEqual(inspect('https://custom-api.example.com/'), [{
    source: '/backend-api/:path*',
    destination: 'https://custom-api.example.com/:path*'
  }]);
});
