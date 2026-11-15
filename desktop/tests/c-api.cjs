'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCAPI } = require('../runtime/backend.cjs');
const config = { image: require('../c-edition.json').image, dockerPath: process.platform === 'win32' ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' : '/usr/bin/docker' };
config.auditFile = require('node:path').join(require('node:os').tmpdir(), 'bolt-c-api-unit-'+process.pid+'.jsonl');
const project = { files: { 'main.c': 'int main(void) { return 0; }\n' } };
function req(route, value) { return new Request('http://127.0.0.1:41000/api/c/'+route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }); }
test('run cannot bypass the explicit source review ticket', async () => {
 const api = createCAPI(config);
 assert.equal((await api.handle(req('run', {project}))).status, 403);
 await api.close();
});
test('review is bound to exact source and a mismatch consumes its one-use ticket', async () => {
 const api = createCAPI(config);
 const review = await (await api.handle(req('preview', project))).json();
 assert.match(review.hash, /^[a-f0-9]{64}$/); assert.equal(review.expiresInSeconds,120);
 const changed = {files: {'main.c':'int main(void) { return 1; }\n'}};
 assert.equal((await api.handle(req('run', { project:changed,ticket:review.ticket }))).status,403);
 assert.equal((await api.handle(req('run', { project,ticket:review.ticket }))).status,403);
 await api.close();
});
test('review rejects JavaScript, compilation flags, traversals, shell code and unapproved files', async () => {
 const api = createCAPI(config);
 for (const value of [{files:{'index.js':'alert(1)'}},{...project,flags:['--privileged']},{files:{'../main.c':'int main(void){return 0;}'}},{files:{'main.c':'int main(void){return 0;}','Makefile':'all:;id'}}]) assert.equal((await api.handle(req('preview',value))).status,400);
 await api.close();
});
test('review limit is bounded and does not start a container', async () => {
 const api = createCAPI(config);
 for(let i=0;i<20;i++) assert.equal((await api.handle(req('preview',project))).status,200);
 assert.equal((await api.handle(req('preview',project))).status,429);
 await api.close();
});
