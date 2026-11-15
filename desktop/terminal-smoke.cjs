'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

module.exports = async function terminalSmoke(window, outputDir) {
  window.show(); window.focus(); window.webContents.focus();
  const nonce = crypto.randomBytes(5).toString('hex');
  const evaluate = (code) => window.webContents.executeJavaScript(code);
  const evidence = { nonce, inference: 'Real configured model; no fixture or replacement model output', runtime: 'Real WebContainer and xterm', cases: [] };
  const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');
  const save = async () => {
    if (!outputDir) return;
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'terminal-e2e.json'), JSON.stringify(evidence, null, 2));
    fs.writeFileSync(path.join(outputDir, 'terminal-e2e.png'), (await window.webContents.capturePage()).toPNG());
    const state = await evaluate('({chat:window.__boltChatQA,terminal:window.__boltTerminalQA?.snapshot(),body:document.body.innerText})');
    fs.writeFileSync(path.join(outputDir, 'terminal-state.json'), JSON.stringify(state, null, 2));
  };
  const wait = async (code, label, milliseconds = 80000) => {
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      const value = await evaluate(code);
      if (value) return value;
      const error = await evaluate('window.__boltChatQA?.error');
      if (error) throw new Error('Actual chat request failed: ' + error);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Terminal E2E timed out: ' + label);
  };
  const submit = async (prompt) => {
    await evaluate('document.querySelector("textarea[placeholder]").focus()');
    await window.webContents.insertText(prompt);
    await new Promise((resolve) => setTimeout(resolve, 150));
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  };
  try {
    await wait('Boolean(window.__boltChatQA && document.querySelector("textarea[placeholder]"))', 'real chat hydration');
    await wait('Boolean(window.__boltTerminalQA)', 'terminal workbench hydration');
    const boot = await evaluate('Promise.race([window.__boltTerminalQA.ready(),new Promise(resolve=>setTimeout(()=>resolve(false),100000))])');
    assert.equal(boot, true, 'Real WebContainer boot timed out; no simulated executor was used');
    evidence.model = await evaluate('fetch("/api/desktop/info").then(r=>r.json()).then(info=>({provider:info.provider,model:info.model}))');
    const filename = `qa-${nonce}/proof.cjs`;
    const marker = 'BOLT_AI_TERMINAL_' + nonce;
    const prompt = `Run this exact harmless workspace test in the built-in terminal. Respond with the following literal XML artifact, not Markdown fences or JavaScript objects; no commentary. These are file and command instructions for the client to execute, not a claim of success. No native tools or packages.\n<boltArtifact id="terminal-proof-${nonce}" title="Terminal proof"><boltAction type="file" filePath="${filename}">const result = [2,5,9].reduce((sum,x) =&gt; sum+x*x,0);\nconsole.log('${marker}', result);</boltAction><boltAction type="shell">node ${filename}</boltAction></boltArtifact>`.replace('=&gt;', '=>');
    console.log('TERMINAL_E2E real-model UI request');
    await submit(prompt);
    await wait('window.__boltChatQA?.messages.some(m=>m.role==="assistant") && !window.__boltChatQA.isLoading', 'model response completion', 120000);
    const generated = await evaluate('window.__boltChatQA.messages.at(-1).content');
    assert.ok(generated.includes('<boltArtifact') && generated.includes('</boltAction>'), 'Real model did not emit closed executable artifact tags; its prose was not coerced into commands');
    await wait('Boolean(window.__boltTerminalQA?.snapshot().receipts.some(r=>r.command.includes(' + JSON.stringify(filename) + ') && r.status==="complete"))', 'model-generated shell completion');
    const state = await evaluate('window.__boltTerminalQA.snapshot()');
    const receipt = state.receipts.find((r) => r.command.includes(filename) && r.status === 'complete');
    assert.equal(receipt.exitCode, 0);
    assert.match(plain(receipt.output), new RegExp(marker + '\\s+110'));
    await wait('window.__boltTerminalQA.snapshot().assistantOutput.includes(' + JSON.stringify(marker) + ')', 'visible xterm replay');
    const source = await evaluate(`window.__boltTerminalQA.readFile(${JSON.stringify(filename)})`);
    assert.ok(source.length > 20);
    evidence.cases.push({ name: 'real model → real UI → parser → file → shell → xterm', passed: true, receipt, source });

    console.log('TERMINAL_E2E real interactive keyboard path');
    await wait('window.__boltTerminalQA.snapshot().interactiveCount > 0', 'interactive shell attachment');
    await evaluate('document.querySelector("[data-testid=interactive-terminal-tab-0]").click()');
    const manual = 'BOLT_MANUAL_' + nonce;
    await evaluate(`window.__boltTerminalQA.input(${JSON.stringify('echo ' + manual + '\r')})`);
    await wait('window.__boltTerminalQA.snapshot().interactiveScreen.split("\\n").includes(' + JSON.stringify(manual) + ')', 'real manual echo output');
    evidence.cases.push({ name: 'xterm input → interactive jsh → actual output', passed: true, marker: manual });

    evidence.feedbackCoverage = 'Separate optional real-model quality gate; this execution test alone does not prove successful feedback summarization';
    if (process.env.BOLT_DESKTOP_SMOKE_FEEDBACK === '1') {
      console.log('TERMINAL_E2E optional real-model feedback request');
      const messageCount = await evaluate('window.__boltChatQA.messages.length');
      await submit('Using the actual terminal receipt from the previous command, report its exit code, exact printed marker and computed number. Do not run any commands or create any artifact.');
      await wait(`window.__boltChatQA.messages.length > ${messageCount} && !window.__boltChatQA.isLoading`, 'follow-up model response');
      const messages = await evaluate('window.__boltChatQA.messages');
      const followup = messages.at(-1).content;
      assert.ok(messages.at(-2).content.includes('<bolt_terminal_results>'));
      assert.ok(followup.includes(marker));
      assert.ok(followup.includes('110'));
      assert.ok(!followup.includes('<boltArtifact'), 'The real model must obey the no-command feedback request');
      evidence.cases.push({ name: 'actual terminal receipt → next real model turn', passed: true, response: followup });
    }

    console.log('TERMINAL_E2E labelled real-execution fixtures');
    const fixture = `<boltArtifact id="fixture-${nonce}" title="Labelled real execution fixtures"><boltAction type="shell">node -e "console.error('BOLT_EXPECTED_FAILURE_${nonce}');process.exit(7)"</boltAction><boltAction type="shell">node -e "console.log('BOLT_RECOVERED_${nonce}')"</boltAction><boltAction type="file" filePath="qa-${nonce}/server.cjs">require('http').createServer((req,res)=>res.end('BOLT_QUEUE_PREVIEW')).listen(5173,'0.0.0.0',()=>console.log('Server on port 5173'));</boltAction><boltAction type="shell" background="true" port="5173">node qa-${nonce}/server.cjs</boltAction><boltAction type="shell">node -e "console.log('BOLT_QUEUE_RELEASED_${nonce}')"</boltAction></boltArtifact>`;
    await evaluate(`window.__boltTerminalQA.parseFixture('fixture-${nonce}', ${JSON.stringify(fixture)})`);
    await wait(`window.__boltTerminalQA.snapshot().receipts.some(r=>r.output.includes('BOLT_QUEUE_RELEASED_${nonce}') && r.status==='complete')`, 'background readiness releases queued finite action');
    const fixtures = await evaluate(`window.__boltTerminalQA.snapshot().artifacts['fixture-${nonce}'].actions`);
    const failed = Object.values(fixtures).find((a) => a.status === 'failed');
    assert.equal(failed.exitCode, 7);
    assert.ok(failed.output.includes('BOLT_EXPECTED_FAILURE_' + nonce));
    assert.ok(Object.values(fixtures).some((a) => a.output?.includes('BOLT_RECOVERED_' + nonce) && a.exitCode === 0));
    assert.ok(Object.values(fixtures).some((a) => a.background && a.status === 'started'));
    evidence.cases.push({ name: 'labelled fixtures: exit7/failure, queue recovery, server-ready/started, subsequent exit0', passed: true, actions: fixtures });
    await evaluate('document.querySelector("[data-testid=stop-assistant-processes]").click()');
    await wait(`Object.values(window.__boltTerminalQA.snapshot().artifacts['fixture-${nonce}'].actions).some(a=>a.background && a.status==='aborted')`, 'real running server abort');
    evidence.cases.push({ name: 'Stop kills the owned background process and records aborted', passed: true });
    evidence.passed = true;
    await save();
    console.log('TERMINAL_E2E_RESULT ' + JSON.stringify({ passed: true, nonce, cases: evidence.cases.map((c) => c.name) }));
    return evidence;
  } catch (error) {
    evidence.passed = false; evidence.error = error.message;
    await save();
    throw error;
  }
};
