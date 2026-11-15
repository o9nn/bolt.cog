import { createHash, webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCSystemPrompt } from '~/lib/.server/llm/c-prompts';
import {
  C17_STANDARD_HEADERS,
  C_PROJECT_LIMITS,
  CProjectValidationError,
  canonicalCProject,
  canonicalSerializeCProject,
  extractCProjectFromMessage,
  hashCProject,
  parseCArtifactComplete,
  validateCProject,
} from './c-project';

const main = 'int main(void) { return 0; }\n';
const project = (source = main) => ({ files: { 'main.c': source } });
const action = (path: string, content: string) => `<boltAction type="file" filePath="${path}">${content}</boltAction>`;
const artifact = (children: string) => `<boltArtifact id="c-project" title="C project">${children}</boltArtifact>`;

afterEach(() => vi.unstubAllGlobals());

describe('validateCProject data contract', () => {
  it('copies a JSON-shaped project, preserving exact Unicode comments, strings and stdin', () => {
    const source = '// café 中文 __asm__\n#include <stdio.h>\nint main(void) { puts("typeof 🧪"); return 0; }\n';
    const input = { files: { 'main.c': source }, stdin: 'é🧪\n' };
    const parsed = validateCProject(input);
    expect(parsed).toEqual(input);
    expect(parsed.files).not.toBe(input.files);
    input.files['main.c'] = main;
    expect(parsed.files['main.c']).toBe(source);
  });

  it('does not mistake inherited Object.prototype members for unknown project keys', () => {
    expect(validateCProject(project())).toEqual(project());
    expect(validateCProject(Object.assign(Object.create(null), project()))).toEqual(project());
  });

  it.each([null, undefined, 12, 'source', [], { stdin: '' }, { files: [] }, { files: null }])(
    'rejects missing or nonobject data (%#)',
    (input) => expect(() => validateCProject(input)).toThrow(CProjectValidationError),
  );

  it.each(['compilerFlags', 'flags', 'build', 'scripts', 'command', 'toString', '__proto__'])(
    'rejects own unknown project key %s',
    (key) => {
      const input = JSON.parse(JSON.stringify({ ...project(), [key]: 'forbidden' }));
      expect(() => validateCProject(input)).toThrow(/Unknown project key/);
    },
  );

  it('rejects class instances, inherited custom properties, symbols and accessors without invoking getters', () => {
    class NonJSONProject {
      files = { 'main.c': main };
    }

    expect(() => validateCProject(new NonJSONProject())).toThrow(/plain JSON/);
    expect(() => validateCProject(Object.assign(Object.create({ flags: '-fgnu89-inline' }), project()))).toThrow(
      /plain JSON/,
    );
    expect(() => validateCProject({ ...project(), [Symbol('option')]: 1 })).toThrow(/symbol/);

    const getter = vi.fn(() => ({ 'main.c': main }));
    const input = Object.defineProperty({}, 'files', { get: getter, enumerable: true });
    expect(() => validateCProject(input)).toThrow(/data properties/);
    expect(getter).not.toHaveBeenCalled();
    expect(() => validateCProject({ files: Object.defineProperty({}, 'main.c', { value: main }) })).toThrow(
      /data properties/,
    );
  });

  it.each([undefined, null, 1, true, {}, []])('rejects nonstring source or stdin (%#)', (value) => {
    expect(() => validateCProject({ files: { 'main.c': value } })).toThrow(/must be a string/);
    expect(() => validateCProject({ ...project(), stdin: value })).toThrow(/must be a string/);
  });

  it('cannot admit symlink descriptors as source content', () => {
    expect(() => validateCProject({ files: { 'main.c': { type: 'symlink', target: '/etc/passwd' } } })).toThrow(
      /must be a string/,
    );
  });

  it('requires a .c translation unit and nonempty file set', () => {
    expect(() => validateCProject({ files: {} })).toThrow(/1–32/);
    expect(() => validateCProject({ files: { 'only.h': '' } })).toThrow(/at least one .c/);
  });

  it('enforces 32 files, UTF-8 256 KiB source and 8 KiB stdin boundaries', () => {
    const files = Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`f${index}.c`, main]));
    expect(Object.keys(validateCProject({ files }).files)).toHaveLength(32);
    expect(() => validateCProject({ files: { ...files, 'extra.h': '' } })).toThrow(/1–32/);

    const source = ' '.repeat(C_PROJECT_LIMITS.maxSourceBytes);
    expect(validateCProject(project(source)).files['main.c']).toHaveLength(C_PROJECT_LIMITS.maxSourceBytes);
    expect(() => validateCProject(project(`${source} `))).toThrow(/256 KiB/);

    const multibyte = `/*${'é'.repeat(C_PROJECT_LIMITS.maxSourceBytes / 2)}*/`;
    expect(() => validateCProject(project(multibyte))).toThrow(/256 KiB/);

    const stdin = 'é'.repeat(C_PROJECT_LIMITS.maxStdinBytes / 2);
    expect(validateCProject({ ...project(), stdin }).stdin).toBe(stdin);
    expect(() => validateCProject({ ...project(), stdin: `${stdin}a` })).toThrow(/8 KiB/);
  });

  it('rejects unpaired surrogates to keep encoding/hashing injective', () => {
    expect(() => validateCProject(project('// \ud800'))).toThrow(/surrogate/);
    expect(() => validateCProject({ ...project(), stdin: '\udc00' })).toThrow(/surrogate/);
    expect(() => validateCProject({ ...project(), stdin: '\ud800x' })).toThrow(/surrogate/);
  });
});

describe('ASCII relative C-only paths', () => {
  it.each([
    '/main.c',
    '\\main.c',
    'C:/main.c',
    'src\\main.c',
    '../main.c',
    './main.c',
    'src/../main.c',
    'src//main.c',
    '.hidden/main.c',
    'src/.main.c',
    'src/ main.c',
    'máin.c',
    'main.c\0',
    'main.c\n',
    'main%2ec',
    'main.c:evil',
    'main.c.',
    'dir./main.c',
    'CON.c',
    'src/Lpt1.h',
    'Makefile',
    'makefile.c.sh',
    'package.json',
    'index.js',
    'main.cpp',
    'main.cc',
    'main.C',
    'main.H',
    'main.hpp',
    'index.html',
    'run.sh',
    `${'a'.repeat(65)}.c`,
    `${'a'.repeat(64)}/${'b'.repeat(64)}/${'c'.repeat(64)}/${'d'.repeat(64)}/main.c`,
  ])('rejects unsafe or non-C path %s', (path) => {
    expect(() => validateCProject({ files: { [path]: main } })).toThrow(CProjectValidationError);
  });

  it('accepts simple and nested names with nonhidden underscores, hyphens and dots', () => {
    expect(validateCProject({ files: { 'src_v1/hello-world.c': main, 'lib/test.v2.h': '' } }).files).toHaveProperty(
      'src_v1/hello-world.c',
    );
  });

  it.each([
    { 'main.c': main, 'MAIN.c': main },
    { 'src/main.c': main, 'Src/util.h': '' },
    { 'a.c': main, 'a.c/b.h': '' },
  ])('rejects file or directory case/collision aliases (%#)', (files) => {
    expect(() => validateCProject({ files })).toThrow(/colli/i);
  });
});

describe('minimal source-aware C17 policy', () => {
  it('allows every C17 standard header', () => {
    const source = `${C17_STANDARD_HEADERS.map((header) => `#include <${header}>`).join('\n')}\n${main}`;
    expect(validateCProject(project(source)).files['main.c']).toBe(source);
  });

  it('allows same-directory and nested local headers, comments around directive tokens, and header guards', () => {
    const files = {
      'src/main.c':
        '#/**/include/**/ "detail/util.h" // header\n#include "same.h"\nint main(void) { return add(1, 2); }',
      'src/detail/util.h': '#ifndef UTIL_H\n#define UTIL_H\nint add(int, int);\n#endif\n',
      'src/same.h': '/* __attribute__((test)) */\n',
      'src/detail/util.c': '#include "util.h"\nint add(int a, int b) { return a + b; }\n',
    };
    expect(validateCProject({ files }).files).toEqual(files);
  });

  it.each([
    '#include <unistd.h>',
    '#include <windows.h>',
    '#include <iostream>',
    '#include <bits/stdc++.h>',
    '#include </stdio.h>',
    '#include <../stdio.h>',
    '#include "../local.h"',
    '#include "/local.h"',
    '#include "src\\local.h"',
    '#include "stdio.h"',
    '#include "missing.h"',
    '#include "local.c"',
    '#include HEADER',
    '#define HEADER <stdio.h>\n#include HEADER',
    '#include <stdio.h> extra',
    '#include_next <stdio.h>',
    '#import <stdio.h>',
    '#pragma GCC poison main',
  ])('rejects platform, missing, traversal, macro or malformed includes/directives (%#)', (source) => {
    expect(() => validateCProject(project(`${source}\n${main}`))).toThrow(CProjectValidationError);
  });

  it('does not fall back to the project root or fold the case of local includes', () => {
    expect(() => validateCProject({ files: { 'src/main.c': '#include "root.h"\n', 'root.h': '' } })).toThrow(
      /must exist/,
    );
    expect(() => validateCProject({ files: { 'main.c': '#include "LOCAL.h"\n', 'local.h': '' } })).toThrow(
      /must exist/,
    );
  });

  it.each(['__asm__', 'asm', '__typeof__', 'typeof', '__builtin_trap', '__attribute__', '__declspec'])(
    'rejects active extension token %s while ignoring its text in comments and literals',
    (token) => {
      expect(() => validateCProject(project(`${token}(0);\n${main}`))).toThrow(/Non-C17 extension/);

      const source = `/* ${token} */\n// ${token}\nconst char *s = "${token} \\"quoted\\"";\n${main}`;
      expect(validateCProject(project(source)).files['main.c']).toBe(source);
    },
  );

  it('matches tokens, not identifier substrings, and respects escaped quotes and character literals', () => {
    const source = `int my_typeof = 0; int asm_helper = 0; char quote = '\\'';\nconst char *s = "\\"__asm__\\"";\n${main}`;
    expect(validateCProject(project(source)).files['main.c']).toBe(source);
  });

  it('ignores include-shaped strings and comments, including Unicode text', () => {
    const source = `/* #include <windows.h> */\n// %:include <unistd.h>\nconst char *s = "#include <iostream> 中文";\n${main}`;
    expect(validateCProject(project(source)).files['main.c']).toBe(source);
  });

  it.each([
    '%:include <stdio.h>',
    '??=include <stdio.h>',
    '??=include <unistd.h>',
    '#inc\\\nlude <stdio.h>',
    '#include <std\\\nio.h>',
    '#include \\\r\n<stdio.h>',
    '#define HELLO \\\n1',
    '#include ??/\n<stdio.h>',
    '%\\\n:include <stdio.h>',
    '??/\n%:include <stdio.h>',
  ])('rejects alternate or spliced preprocessing forms (%#)', (source) => {
    expect(() => validateCProject(project(`${source}\n${main}`))).toThrow(/Digraph|Trigraph|line-splices/);
  });

  it('strips code line splices before token screening but permits normal nonpreprocessor code splices', () => {
    expect(() => validateCProject(project('__as\\\nm__(0);'))).toThrow(/Non-C17 extension/);

    const source = 'int main(void) { ret\\\nurn 0; }\n';
    expect(validateCProject(project(source)).files['main.c']).toBe(source);
    expect(validateCProject(project('// continued comment \\\n__asm__(0);\n' + main))).toEqual(
      project('// continued comment \\\n__asm__(0);\n' + main),
    );
  });

  it.each(['/* unclosed', 'const char *s = "unclosed', "char c = 'x", 'const char *s = "line\nbreak";'])(
    'rejects lexically incomplete source (%#)',
    (source) => expect(() => validateCProject(project(source))).toThrow(/Unterminated/),
  );

  it('is explicitly not a full syntax checker; incomplete C grammar requires real compiler diagnostics', () => {
    expect(validateCProject(project('int main(void) {'))).toEqual(project('int main(void) {'));
  });
});

describe('canonical serialization and browser SHA-256', () => {
  it('sorts paths deterministically, preserves exact content and distinguishes optional stdin', () => {
    const a = { files: { 'z.h': '', 'main.c': main, 'a.h': '' }, stdin: 'hello\n' };
    const b = { stdin: 'hello\n', files: { 'a.h': '', 'main.c': main, 'z.h': '' } };
    expect(canonicalCProject(a)).toBe(canonicalSerializeCProject(b));
    expect(canonicalCProject(project())).toBe(JSON.stringify(project()));
    expect(canonicalCProject({ ...project(), stdin: '' })).not.toBe(canonicalCProject(project()));
    expect(() => canonicalCProject({ files: { 'main.js': main } })).toThrow(CProjectValidationError);
  });

  it('agrees with Node SHA-256 and changes with source, path or stdin mutations', async () => {
    vi.stubGlobal('crypto', webcrypto);

    const input = { files: { 'z.h': '', 'main.c': main }, stdin: 'abc' };
    const hash = await hashCProject(input);
    expect(hash).toBe(createHash('sha256').update(canonicalCProject(input), 'utf8').digest('hex'));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await hashCProject({ stdin: 'abc', files: { 'main.c': main, 'z.h': '' } })).toBe(hash);
    expect(await hashCProject({ ...input, files: { ...input.files, 'main.c': `${main}\n` } })).not.toBe(hash);
    expect(await hashCProject({ ...input, files: { 'other.c': main, 'z.h': '' } })).not.toBe(hash);
    expect(await hashCProject({ ...input, stdin: 'abcd' })).not.toBe(hash);
    expect(await hashCProject({ files: input.files })).not.toBe(hash);
  });

  it('fails explicitly if secure-context Web Crypto is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);
    await expect(hashCProject(project())).rejects.toThrow(/Web Crypto/);
  });
});

describe('strict complete C artifact protocol', () => {
  it('returns a validated complete project and preserves file bodies verbatim', () => {
    const source = `\n  #include "lib/util.h"\n${main}\n`;
    const message = ` \n${artifact(action('main.c', source) + '\n' + action('lib/util.h', '// header\n'))}\n `;
    const parsed = parseCArtifactComplete(message);
    expect(parsed).toEqual({ files: { 'main.c': source, 'lib/util.h': '// header\n' } });
    expect(extractCProjectFromMessage(message)).toEqual(parsed);
  });

  it('allows attribute order and whitespace variations, not content rewriting', () => {
    const message = `<boltArtifact title="C" id="ok" >\n<boltAction filePath="main.c" type="file" >${main}</boltAction>\n</boltArtifact>`;
    expect(parseCArtifactComplete(message).files['main.c']).toBe(main);
  });

  it.each([
    '',
    main,
    `\`\`\`c\n${main}\`\`\``,
    '<boltArtifact',
    '<boltArtifact id="test" title="C">',
    '<boltArtifact id="test" title="C"><boltAction type="file" filePath="main.c">int main',
    `<boltArtifact id="test" title="C">${action('main.c', main)}`,
    `${artifact(action('main.c', main))}<boltAction type="shell">echo no</boltAction>`,
    `Prose ${artifact(action('main.c', main))}`,
    `${artifact(action('main.c', main))} Prose`,
    artifact(''),
    artifact('unexpected text'),
    artifact('<boltAction type="shell">gcc main.c</boltAction>'),
    artifact('<boltAction type="shell" filePath="main.c">gcc main.c</boltAction>'),
    artifact('<boltAction type="unknown" filePath="main.c">code</boltAction>'),
    artifact(action('main.js', 'console.log(1)')),
    artifact(action('main.cpp', '#include <iostream>')),
    artifact(action('Makefile', 'all:')),
    artifact(action('main.c', main) + action('main.c', main)),
    artifact(action('main.c', '<boltArtifact id="x" title="x">')),
    artifact(action('main.c', '// <boltAction type="shell">')),
    artifact(action('main.c', '// <boltaction>')),
    artifact('<boltAction type="file" filePath="main.c" extra="yes">code</boltAction>'),
    artifact('<boltAction type="file" type="shell" filePath="main.c">code</boltAction>'),
    artifact('<boltAction type=\'file\' filePath="main.c">code</boltAction>'),
    artifact('<boltAction type="file" filePath="main&#46;c">code</boltAction>'),
    artifact('<boltAction type="file" filePath="main.c"/>'),
    artifact('<boltActionX type="file" filePath="main.c">code</boltAction>'),
    `<boltArtifact id="one" id="two" title="C">${action('main.c', main)}</boltArtifact>`,
    `<boltArtifact id="one" title="C" extra="x">${action('main.c', main)}</boltArtifact>`,
    `<boltArtifact id="../one" title="C">${action('main.c', main)}</boltArtifact>`,
    `<boltArtifact id="one" title="C &amp; C">${action('main.c', main)}</boltArtifact>`,
    `${artifact(action('main.c', main))}${artifact(action('other.c', main))}`,
  ])('rejects malformed, incomplete, nonfile or non-C output rather than inventing code (%#)', (message) => {
    expect(() => parseCArtifactComplete(message)).toThrow(CProjectValidationError);
  });

  it('validates policy across the entire project after complete actions, not only each action separately', () => {
    expect(() => parseCArtifactComplete(artifact(action('main.c', '#include "missing.h"\n' + main)))).toThrow(
      /must exist/,
    );
    expect(() => parseCArtifactComplete(artifact(action('main.c', main) + action('MAIN.c', main)))).toThrow(/colli/i);
  });

  it('bounds the model envelope and file count', () => {
    expect(() => parseCArtifactComplete(' '.repeat(C_PROJECT_LIMITS.maxSourceBytes + 64 * 1024 + 1))).toThrow(
      /envelope/,
    );

    const message = artifact(Array.from({ length: 33 }, (_, index) => action(`f${index}.c`, main)).join(''));
    expect(() => parseCArtifactComplete(message)).toThrow(/32 file actions/);
  });
});

describe('getCSystemPrompt', () => {
  it('names the constrained protocol and requires real compiler/sandbox receipts without provider substitution', () => {
    const prompt = getCSystemPrompt();
    expect(prompt).toContain('C17');
    expect(prompt).toContain('type="file"');
    expect(prompt).toContain('No Makefiles');
    expect(prompt).toContain('Docker');
    expect(prompt).toContain('PENDING');
    expect(prompt).toContain('untrusted data');
    expect(prompt).toContain('real AI SDK');
    expect(prompt).toContain('scanner is a limited policy screen');
    expect(prompt).not.toContain('type="shell"');
  });
});
