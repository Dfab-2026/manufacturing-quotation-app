import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveApiRouting, normalizeApiBase, DEFAULT_LOCAL_API, DEFAULT_RENDER_API} from '../lib/apiRouting.ts';
test('local uses only local service even with production environment variables', () => {
  for (const host of ['localhost','127.0.0.1','[::1]']) {
    assert.deepEqual(resolveApiRouting(host, DEFAULT_RENDER_API, DEFAULT_RENDER_API), {primary:DEFAULT_LOCAL_API,targets:[DEFAULT_LOCAL_API]});
  }
});
test('custom local backend port is retained',()=>{
  const local='http://127.0.0.1:8001';
  assert.deepEqual(resolveApiRouting('localhost',local+'/api/',DEFAULT_RENDER_API),{primary:local,targets:[local]});
});
test('normal production uses direct same backend, not the deprecated rewrite',()=>{
  assert.deepEqual(resolveApiRouting('quotation.vercel.app','',''),{primary:DEFAULT_RENDER_API,targets:[DEFAULT_RENDER_API]});
  const url='https://test-api.example.com';
  assert.deepEqual(resolveApiRouting('quotation.vercel.app',url+'/api/',DEFAULT_RENDER_API),{primary:url,targets:[url]});
});
test('production never points to loopback from stale env configuration',()=>{
  assert.equal(resolveApiRouting('quotation.vercel.app',DEFAULT_LOCAL_API,'').primary,DEFAULT_RENDER_API);
});
test('explicit proxy mode is still supported for existing custom deployments',()=>{
  assert.deepEqual(resolveApiRouting('quotation.vercel.app','/backend-api',DEFAULT_RENDER_API),{primary:'/backend-api',targets:[DEFAULT_RENDER_API,'/backend-api']});
});
test('normalize trailing API suffix and slashes',()=>{
  assert.equal(normalizeApiBase(' https://example.com/api/// '),'https://example.com');
});
