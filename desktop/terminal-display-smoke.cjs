'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

module.exports = async function terminalDisplaySmoke(window, outputDir) {
  window.show(); window.focus();
  await window.webContents.executeJavaScript('new Promise((resolve,reject)=>{const deadline=Date.now()+20000;const timer=setInterval(()=>{if(window.__boltTerminalQA && window.__boltTerminalDisplayQA){clearInterval(timer);resolve(true)}else if(Date.now()>deadline){clearInterval(timer);reject(new Error("Display diagnostic did not initialize"))}},100)})');
  await window.webContents.executeJavaScript('window.__boltTerminalQA.ready()');
  const id = 'display-fixture-' + randomBytes(4).toString('hex');
  const synthetic = 'starting\r\n/\x1b[1G\x1b[0K-\x1b[1G\x1b[0K\\\x1b[1G\x1b[0K|\x1b[1G\x1b[0Kadded 126 packages in 37s\r\n\x1b[32mVITE\x1b[0m v5.4.21 ready in 2683 ms\r\nhttp://localhost:5173/\r\n';
  const raw = process.env.BOLT_DESKTOP_SMOKE_LOG_FILE ? fs.readFileSync(process.env.BOLT_DESKTOP_SMOKE_LOG_FILE, 'utf8') : synthetic;
  const encoded = Buffer.from(raw).toString('base64');
  const filePath = `qa-${id}/replay.cjs`;
  const command = `node ${filePath}`;
  const source = `process.stdout.write(Buffer.from('${encoded}','base64'));`;
  const artifact = `<boltArtifact id="${id}" title="Labelled terminal log display fixture"><boltAction type="file" filePath="${filePath}">${source}</boltAction><boltAction type="shell">${command}</boltAction></boltArtifact>`;
  await window.webContents.executeJavaScript(`window.__boltTerminalQA.parseFixture(${JSON.stringify(id)},${JSON.stringify(artifact)}); window.__boltTerminalDisplayQA.mount(${JSON.stringify(id)})`);
  await window.webContents.executeJavaScript('window.__boltTerminalQA.wait()');
  const receipt = await window.webContents.executeJavaScript(`window.__boltTerminalQA.snapshot().artifacts[${JSON.stringify(id)}].actions['1']`);
  assert.equal(receipt.status, 'complete'); assert.equal(receipt.exitCode, 0);
  // PTYs may translate LF to CRLF; compare only that transport normalization.
  assert.equal(receipt.output.replace(/\r+\n/g, '\n'), raw.replace(/\r+\n/g, '\n'));
  assert.match(receipt.output, /[\x1b\x9b]/);
  const display = await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const deadline=Date.now()+20000;const timer=setInterval(()=>{const el=document.querySelector('[data-testid="terminal-display-fixture"] [data-testid="shell-action-result"]');const text=el?.innerText || '';if(text.includes('added 126 packages') && text.includes('VITE') && !el.querySelector('[aria-busy="true"]')){clearInterval(timer);resolve(text)}else if(Date.now()>deadline){clearInterval(timer);reject(new Error('Readable actual Artifact output not ready: '+JSON.stringify(text.slice(-500))))}},100)})`);
  assert.doesNotMatch(display, /[\x1b\x9b]/);
  assert.doesNotMatch(display, /(?:[|/\\-]){12,}/);
  assert.match(display, /added 126 packages in 37s/);
  assert.match(display, /VITE.*v5\.4\.21/);
  assert.match(display, /localhost:5173/);
  const after = await window.webContents.executeJavaScript(`window.__boltTerminalQA.snapshot().artifacts[${JSON.stringify(id)}].actions['1'].output`);
  assert.equal(after, receipt.output);
  const result = {passed:true,scope:'Explicit log replay through real Node/JSH, ActionRunner and actual Artifact component; not a neural inference test',source:process.env.BOLT_DESKTOP_SMOKE_LOG_FILE ? 'User-provided local attachment (not committed)' : 'Synthetic ANSI log fixture',rawPreserved:true,exitCode:receipt.exitCode,ansiControlsVisible:false,spinnerHistoryVisible:false,display};
  if(outputDir){fs.mkdirSync(outputDir,{recursive:true});fs.writeFileSync(path.join(outputDir,'terminal-display.json'),JSON.stringify(result,null,2)+'\n');fs.writeFileSync(path.join(outputDir,'terminal-display.png'),(await window.webContents.capturePage()).toPNG());}
  await window.webContents.executeJavaScript('window.__boltTerminalDisplayQA.dispose()');
  console.log('TERMINAL_DISPLAY_RESULT '+JSON.stringify({...result,display:undefined}));
  return result;
};
