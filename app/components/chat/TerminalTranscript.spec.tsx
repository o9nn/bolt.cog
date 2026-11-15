/** @vitest-environment jsdom */
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalTranscript } from '~/components/chat/TerminalTranscript';
import { TRANSCRIPT_COLS, TRANSCRIPT_ROWS, TRANSCRIPT_SCROLLBACK } from '~/components/chat/terminal-transcript';

/**
 * This fake supplies already-parsed buffer text. It tests React transport and
 * teardown only; real xterm/browser parser semantics require Electron tests.
 */
const mock = vi.hoisted(() => {
  // acknowledge the Remix development transform in this isolated DOM unit test
  Object.assign(window, { __vite_plugin_react_preamble_installed__: true });

  return {
    created: [] as {
      options: Record<string, unknown>;
      writes: string[];
      callbacks: (() => void)[];
      text: string;
      dispose: ReturnType<typeof vi.fn>;
    }[],
    failCreate: false,
  };
});

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    readonly state: (typeof mock.created)[number];
    readonly cols = 120;

    constructor(options: Record<string, unknown>) {
      if (mock.failCreate) {
        throw new Error('unavailable browser');
      }

      this.state = { options, writes: [], callbacks: [], text: '', dispose: vi.fn() };
      mock.created.push(this.state);
    }

    get buffer() {
      return {
        active: {
          length: 1,
          getLine: () => ({
            length: 120,
            isWrapped: false,
            getCell: () => undefined,
            translateToString: () => this.state.text,
          }),
        },
      };
    }

    write(data: string, callback: () => void) {
      this.state.writes.push(data);
      this.state.callbacks.push(callback);
    }

    dispose() {
      this.state.dispose();
    }
  },
}));

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  mock.created.length = 0;
  mock.failCreate = false;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  host.remove();
});

async function load() {
  await act(async () => {
    // let the dynamic import settle, without pretending the fake is a parser
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function finish(index: number, text: string) {
  act(() => {
    mock.created[index].text = text;
    mock.created[index].callbacks.shift()!();
  });
}

describe('TerminalTranscript React lifecycle (mocked xterm transport)', () => {
  it('SSR renders only a safe placeholder, with no browser terminal construction or raw escape bytes', () => {
    const html = renderToString(<TerminalTranscript output={'\u001b[31m<script>bad</script>'} />);
    expect(html).toContain('Preparing terminal output');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('\u001b');
    expect(html).not.toContain('<script>');
    expect(mock.created).toHaveLength(0);
  });

  it('never flashes raw escapes while loading or before the write callback, and renders buffer text safely', async () => {
    const raw = '\u001b[31mraw\u001b[0m';
    act(() => root!.render(<TerminalTranscript output={raw} />));
    expect(host.textContent).toContain('Preparing terminal output');
    expect(host.textContent).not.toContain('\u001b');
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    await load();
    expect(mock.created[0].writes).toEqual([raw]);
    expect(mock.created[0].options).toMatchObject({
      cols: TRANSCRIPT_COLS,
      rows: TRANSCRIPT_ROWS,
      scrollback: TRANSCRIPT_SCROLLBACK,
      convertEol: true,
      disableStdin: true,
      allowProposedApi: false,
    });
    expect(host.textContent).toContain('Preparing terminal output');
    finish(0, '<img src=x onerror=alert(1)> & done');
    expect(host.textContent).toBe('<img src=x onerror=alert(1)> & done');
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('[aria-busy="false"]')).not.toBeNull();
  });

  it('uses the latest prop during lazy loading and streams prefix deltas without reconstruction', async () => {
    act(() => root!.render(<TerminalTranscript output="one" />));
    act(() => root!.render(<TerminalTranscript output="one two" />));
    await load();
    expect(mock.created).toHaveLength(1);
    expect(mock.created[0].writes).toEqual(['one two']);
    finish(0, 'one two');
    act(() => root!.render(<TerminalTranscript output="one two three" />));
    expect(mock.created[0].writes).toEqual(['one two', ' three']);
    finish(0, 'one two three');
    expect(host.textContent).toBe('one two three');
  });

  it('disposes on unmount and suppresses late write callbacks', async () => {
    act(() => root!.render(<TerminalTranscript output="pending" />));
    await load();
    act(() => root!.unmount());
    root = undefined;
    expect(mock.created[0].dispose).toHaveBeenCalledTimes(1);
    finish(0, 'late');
    expect(host.textContent).toBe('');
  });

  it('does not construct an emulator if unmounted before the dynamic import resolves', async () => {
    act(() => root!.render(<TerminalTranscript output="pending" />));
    act(() => root!.unmount());
    root = undefined;
    await load();
    expect(mock.created).toHaveLength(0);
  });

  it('survives StrictMode effect teardown/recreation without stale sessions', async () => {
    act(() =>
      root!.render(
        <StrictMode>
          <TerminalTranscript output="one" />
        </StrictMode>,
      ),
    );
    await load();
    expect(mock.created).toHaveLength(1);
    finish(0, 'one');
    expect(host.textContent).toBe('one');
    act(() => root!.unmount());
    root = undefined;
    expect(mock.created[0].dispose).toHaveBeenCalledTimes(1);
  });

  it('shows an explicit display failure without raw fallback, and clears a previous transcript', async () => {
    mock.failCreate = true;
    act(() => root!.render(<TerminalTranscript output={'\u001b[31mraw'} />));
    await load();
    expect(host.textContent).toContain('Terminal output unavailable');
    expect(host.textContent).not.toContain('\u001b');
    expect(host.querySelector('[data-transcript-state="error"]')).not.toBeNull();
    act(() => root!.render(<TerminalTranscript output="" />));
    expect(host.textContent).toBe('');
  });
});
