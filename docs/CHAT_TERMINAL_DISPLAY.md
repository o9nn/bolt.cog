# Readable terminal output in chat — v0.2.3 display hotfix

Official v0.2.2 terminal execution remains unchanged. Npm/Vite emit ANSI/CSI colour, cursor, erase and spinner controls. The chat result card previously rendered raw `action.output.slice(-2048)` as ordinary React text, exposing escape codes and accumulating spinner characters. This is a display defect, not a failed command or a neural inference defect.

`TerminalTranscript` uses the existing pinned `@xterm/xterm`5.5.0 browser parser, then reads public `buffer.active`/`translateToString` text after the write callback. It does not attach to a process, send input, open terminal DOM, convert output into HTML, use experimental headless dependencies, or replace inference. `allowProposedApi` is false. SSR performs no browser import. Loading/error states never fall back to displaying raw controls; users can inspect the live Assistant terminal.

Raw ActionRunner output, exit/status/error fields, Assistant xterm output and terminal receipts remain unchanged. Each card has an independent emulator. Prefix updates preserve partial ANSI parsing; changed or rolled raw tails recreate the emulator. Updates coalesce to one in-flight write plus one newest snapshot. Cleanup suppresses late import/write callbacks and disposes the emulator.

## Limits

The card is a readable active-buffer/scrollback snapshot, not a complete archival log. It uses120 columns,40 rows,200 scrollback, a32 KiB raw view tail and8 KiB rendered text bound. Explicit screen erases remove rendered text as they do in a terminal. Fixed geometry can differ from the live terminal. If a truncated raw tail starts halfway through a control sequence, missing prefix state cannot be recovered perfectly. No heuristic stripping claims otherwise. Raw execution evidence is retained separately.

## Tests

The focused helper/component tests use labelled synthetic buffers and transport mocks for wrapping, bounds, rapid updates, prefix fragments, source replacement, SSR, React escaping, loading/error/unmount and StrictMode. They are not claimed as real terminal parsing or neural inference tests.

The actual Electron regression replays terminal log bytes through real Node/JSH, the real ActionRunner, and the actual Artifact component. The original user attachment was used locally and is not committed to this repository. It verifies real exit0, readable npm/Vite lines, no visible ESC/CSI/spinner history, and that the raw receipt is identical before and after display formatting. PTY newline translation is qualified separately. This is a **display log-replay fixture**, not model inference or a second actual npm installation.

The full application suite passed272 tests, desktop suite105 tests, TypeScript typecheck and focused lint. The actual user-log browser regression passed with sandbox/context isolation/web security enabled and renderer Node disabled. Native installer build and final preview status are recorded separately, not inferred from unit tests.

Reproduce a synthetic display test:

```bash
node desktop/scripts/build-runtime.cjs
BOLT_DESKTOP_SMOKE_DISPLAY=1 pnpm --dir desktop smoke
```

Optionally supply `BOLT_DESKTOP_SMOKE_LOG_FILE` to a local text file and `BOLT_DESKTOP_SMOKE_OUTPUT` to save a diagnostic result/screenshot. No model endpoint or API credit is used. The fixture is enabled only by explicit loopback smoke flags. Keep user logs and provider secrets out of public source commits.

This change is separate from immutable official `desktop-v0.2.2`. Preview `desktop-v0.2.3` does not become official without explicit publication authorization.

## References

- [xterm.js implementation](https://github.com/xtermjs/xterm.js).
- [Public terminal-buffer text API](https://xtermjs.org/docs/api/terminal/interfaces/ibufferline/).
