'use strict';
// Explicit native integration suite. These are labelled C test programs, NOT neural model responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createCCompiler } = require('../runtime/backend.cjs');
async function main() {
 if (process.env.BOLT_C_INTEGRATION !== '1') { console.log('C native Docker integration not requested; no native execution claimed.'); return; }
 const folder = fs.mkdtempSync(path.join(os.tmpdir(),'bolt-c-real-'));
 const evidence = process.env.BOLT_C_EVIDENCE || folder;
 fs.mkdirSync(evidence,{recursive:true});
 const dockerPath = process.env.BOLT_C_DOCKER_PATH || '/usr/bin/docker';
 const dockerHost = process.env.BOLT_C_DOCKER_HOST || 'unix:///var/run/docker.sock';
 const config = { image:require('../c-edition.json').image,dockerPath,dockerHost,workspace:folder,auditFile:path.join(folder,'audit','c.jsonl') };
 const compiler = createCCompiler(config); const results=[];
 async function run(name, code, check, stdin) {
  console.log('REAL_C_CASE_START',name);
  const receipt=await compiler.execute({files:{'main.c':code},...(stdin===undefined?{}:{stdin})},{requestId:'c-integration-'+name});
  fs.writeFileSync(path.join(evidence,name+'.json'),JSON.stringify(receipt,null,2)+'\n');
  assert.equal(receipt.cleanup.ok,true, 'Owned containers must be removed'); assert.equal(receipt.audit.recorded,true);
  check(receipt);results.push({name,passed:true,receipt});console.log('REAL_C_CASE_PASS',name,receipt.exitCode,receipt.duration);
 }
 try {
  const info=await compiler.info();fs.writeFileSync(path.join(evidence,'preflight.json'),JSON.stringify(info,null,2));assert.equal(info.available,true,info.error?.message);
  await run('arithmetic-assertions','#include <stdio.h>\n#include <assert.h>\nint main(void){int a[]={2,5,9};int s=0;for(unsigned i=0;i<3;i++)s+=a[i]*a[i];assert(s==110);assert(a[0]*a[0]==4);printf("SUM_SQUARES=%d\\n",s);return 0;}\n',r=>{assert.equal(r.success,true);assert.equal(r.compile.exitCode,0);assert.equal(r.run.exitCode,0);assert.equal(r.run.evidence,'docker-wait-inspect');assert.match(r.stdout,/SUM_SQUARES=110/);});
  await run('stdin-real','#include <stdio.h>\nint main(void){int a,b;if(scanf("%d %d",&a,&b)!=2)return 2;printf("SUM=%d\\n",a+b);return a+b==42?0:3;}\n',r=>{assert.equal(r.success,true);assert.match(r.stdout,/SUM=42/);},'19 23\n');
  await run('compiler-rejects-cpp','class Forbidden {}; int main(void){return 0;}\n',r=>{assert.equal(r.success,false);assert.equal(r.status,'compile_failed');assert.notEqual(r.compile.exitCode,0);assert.equal(r.run,undefined);});
  await run('real-nonzero-exit','#include <stdio.h>\nint main(void){puts("success=true is only untrusted text");return 7;}\n',r=>{assert.equal(r.success,false);assert.equal(r.exitCode,7);assert.match(r.stdout,/success=true/);});
  await run('secrets-and-host-files-denied','#include <stdlib.h>\n#include <stdio.h>\nint main(void){if(getenv("ANTHROPIC_API_KEY")||getenv("OPENROUTER_API_KEY")||getenv("HOME")&&getenv("HOME")[0]!=\'/\')return 1;FILE *f=fopen("/home/ubuntu/.user_env","r");if(f){fclose(f);return 2;}f=fopen("/host-sentinel","w");if(f){fclose(f);return 3;}puts("HOST_AND_SECRETS_DENIED");return 0;}\n',r=>{assert.equal(r.success,true);assert.match(r.stdout,/HOST_AND_SECRETS_DENIED/);});
  await run('nonroot-identity','#include <stdio.h>\nextern unsigned int getuid(void);\nint main(void){unsigned int u=getuid();printf("UID=%u\\n",u);return u==65534?0:1;}\n',r=>{assert.equal(r.success,true);assert.match(r.stdout,/UID=65534/);});
  await run('network-egress-denied','#include <stdio.h>\nextern int socket(int,int,int);extern int connect(int,const void *,unsigned int);extern unsigned short htons(unsigned short);extern unsigned int htonl(unsigned int);\nstruct addr {unsigned short family;unsigned short port;unsigned int ip;char pad[8];};\nint main(void){struct addr a={2,0,0,{0}};a.port=htons(443);a.ip=htonl(0x01010101U);int s=socket(2,1,0);if(s>=0&&connect(s,&a,sizeof(a))==0)return 1;puts("EGRESS_DENIED");return 0;}\n',r=>{assert.equal(r.success,true);assert.match(r.stdout,/EGRESS_DENIED/);});
  await run('readonly-root','#include <stdio.h>\nint main(void){FILE *f=fopen("/etc/c-test-write","w");if(f){fclose(f);return 1;}puts("ROOT_WRITE_DENIED");return 0;}\n',r=>{assert.equal(r.success,true);assert.match(r.stdout,/ROOT_WRITE_DENIED/);});
  await run('bounded-infinite-loop','int main(void){for(;;){}return 0;}\n',r=>{assert.equal(r.success,false);assert.ok(r.duration<65000);assert.ok(r.exitCode!==0);});
  await run('output-quota','#include <stdio.h>\nint main(void){for(;;)puts("ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ");return 0;}\n',r=>{assert.equal(r.success,false);assert.equal(r.error?.code,'OUTPUT_LIMIT');assert.ok(Buffer.byteLength(r.stdout+r.stderr)<=65536);});
  await run('memory-quota','#include <stdlib.h>\n#include <string.h>\nint main(void){for(;;){char *p=malloc(16777216);if(!p)return 4;memset(p,42,16777216);}return 0;}\n',r=>{assert.equal(r.success,false);assert.notEqual(r.exitCode,0);assert.ok(r.duration<65000);});
  const abort=new AbortController();const pending=compiler.execute({files:{'main.c':'int main(void){for(;;){}return 0;}\n'}},{requestId:'c-integration-disconnect',signal:abort.signal});setTimeout(()=>abort.abort(),1500);const cancelled=await pending;assert.equal(cancelled.success,false);assert.equal(cancelled.cleanup.ok,true);assert.equal(cancelled.error?.code,'ABORTED');fs.writeFileSync(path.join(evidence,'abort.json'),JSON.stringify(cancelled,null,2));results.push({name:'abort',passed:true,receipt:cancelled});
  // Intentionally compiled adversarial fixtures are constrained by actual container settings, not a fake sandbox.
  await run('process-quota','#include <stdio.h>\n#include <stdlib.h>\nextern int fork(void); extern unsigned int sleep(unsigned int);\nint main(void){int count=0;for(int i=0;i<100;i++){int p=fork();if(p==0){sleep(30);return 0;}if(p<0)break;count++;}printf("CHILDREN=%d\\n",count);return count<64?0:1;}\n',r=>{assert.ok(r.duration<65000);assert.equal(r.cleanup.ok,true);assert.equal(r.run?.oomKilled,false);const count=r.stdout.match(/CHILDREN=(\d+)/);if(count)assert.ok(Number(count[1])<64);});
  const listing=spawnSync(dockerPath,['--host',dockerHost,'ps','-a','--format','{{.Names}}'],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});assert.equal(listing.status,0);assert.doesNotMatch(listing.stdout,/bolt-c17-/,'No orphaned test containers');
  fs.copyFileSync(config.auditFile,path.join(evidence,'audit.jsonl'));fs.writeFileSync(path.join(evidence,'RESULTS.json'),JSON.stringify({passed:true,inference:false,scope:'Real Docker C fixture integration; no neural response fabrication',image:config.image,cases:results},null,2)+'\n');console.log('REAL_C_INTEGRATION_PASSED',results.length,evidence);
 } finally {await compiler.close();}
}
main().catch(e=>{console.error('REAL_C_INTEGRATION_FAILED',e.message);process.exitCode=1;});
