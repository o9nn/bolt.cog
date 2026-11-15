export interface CProject {
  files: Record<string, string>;
  stdin?: string;
}

export const C_PROJECT_LIMITS = Object.freeze({
  maxFiles: 32,
  maxSourceBytes: 256 * 1024,
  maxStdinBytes: 8 * 1024,
  maxPathLength: 240,
  maxPathSegmentLength: 64,
});

/** The complete C17 standard-header allowlist; not C++ or platform headers. */
export const C17_STANDARD_HEADERS = Object.freeze([
  'assert.h',
  'complex.h',
  'ctype.h',
  'errno.h',
  'fenv.h',
  'float.h',
  'inttypes.h',
  'iso646.h',
  'limits.h',
  'locale.h',
  'math.h',
  'setjmp.h',
  'signal.h',
  'stdalign.h',
  'stdarg.h',
  'stdatomic.h',
  'stdbool.h',
  'stddef.h',
  'stdint.h',
  'stdio.h',
  'stdlib.h',
  'stdnoreturn.h',
  'string.h',
  'tgmath.h',
  'threads.h',
  'time.h',
  'uchar.h',
  'wchar.h',
  'wctype.h',
] as const);

const standardHeaders: ReadonlySet<string> = new Set(C17_STANDARD_HEADERS);
const encoder = new TextEncoder();
const owns = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);

export class CProjectValidationError extends Error {
  constructor(message: string) {
    super(`C project policy: ${message}`);
    this.name = 'CProjectValidationError';
  }
}

function fail(message: string): never {
  throw new CProjectValidationError(message);
}

/** Accept JSON-shaped records only, never accessors, arrays, class instances or symbol keys. */
function record(input: unknown, label: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail(`${label} must be an object.`);
  }

  const prototype = Object.getPrototypeOf(input);

  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} must be a plain JSON object.`);
  }

  if (Object.getOwnPropertySymbols(input).length !== 0) {
    fail(`${label} must not have symbol keys.`);
  }

  for (const key of Object.getOwnPropertyNames(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;

    if (!owns(descriptor, 'value') || !descriptor.enumerable) {
      fail(`${label} must contain enumerable data properties only.`);
    }
  }

  return input as Record<string, unknown>;
}

function checkText(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    fail(`${label} must be a string.`);
  }

  // reject unpaired surrogates so UTF-8 replacement cannot alias different input strings
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);

      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail(`${label} contains an unpaired UTF-16 surrogate.`);
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail(`${label} contains an unpaired UTF-16 surrogate.`);
    }
  }

  return value;
}

function checkPath(path: string, headerOnly = false): void {
  if (path.length === 0 || path.length > C_PROJECT_LIMITS.maxPathLength) {
    fail(`Path must contain 1–${C_PROJECT_LIMITS.maxPathLength} ASCII characters.`);
  }

  const segments = path.split('/');

  for (const segment of segments) {
    if (
      segment.length > C_PROJECT_LIMITS.maxPathSegmentLength ||
      !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(segment) ||
      segment.endsWith('.') ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
    ) {
      fail(`Unsafe path "${path}": use non-hidden ASCII relative segments of at most 64 characters.`);
    }
  }

  if (!(headerOnly ? /\.h$/ : /\.(?:c|h)$/).test(path)) {
    fail(`Path "${path}" must end in ${headerOnly ? '.h' : '.c or .h'} (lowercase).`);
  }
}

interface LogicalSource {
  text: string;
  splicedLines: Set<number>;
  trigraphLines: Set<number>;
}

/** Model C translation phases 1/2 for screening only; never rewrite returned source. */
function logicalSource(source: string): LogicalSource {
  const trigraphs: Record<string, string> = {
    '=': '#',
    '/': '\\',
    "'": '^',
    '(': '[',
    ')': ']',
    '!': '|',
    '<': '{',
    '>': '}',
    '-': '~',
  };
  const translated = source.replace(/\?\?([=/'()!<>-])/g, (_, key: string) => `\u0001${trigraphs[key]}`);
  const splicedLines = new Set<number>();
  const trigraphLines = new Set<number>();
  let text = '';
  let line = 0;

  for (let index = 0; index < translated.length; index++) {
    const char = translated[index];

    if (char === '\u0001') {
      trigraphLines.add(line);
      continue;
    }

    // a trigraph-generated backslash followed by a newline is also a splice
    if (char === '\\' && /[\r\n]/.test(translated[index + 1] ?? '')) {
      splicedLines.add(line);
      index++;

      if (translated[index] === '\r' && translated[index + 1] === '\n') {
        index++;
      }

      continue;
    }

    if (char === '\r' || char === '\n') {
      if (char === '\r' && translated[index + 1] === '\n') {
        index++;
      }

      text += '\n';
      line++;
    } else {
      text += char;
    }
  }

  return { text, splicedLines, trigraphLines };
}

/** Two lexical masks: one retains include operands; the other ignores comments and string/character literals. */
function lexicalMasks(text: string, path: string): { commentsRemoved: string; literalsRemoved: string } {
  const comments: string[] = [];
  const literals: string[] = [];
  let state: 'code' | 'line' | 'block' | 'string' | 'character' = 'code';

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    const blank = char === '\n' ? '\n' : ' ';

    if (state === 'line' || state === 'block') {
      comments.push(blank);
      literals.push(blank);

      if (state === 'line' && char === '\n') {
        state = 'code';
      } else if (state === 'block' && char === '*' && next === '/') {
        comments.push(' ');
        literals.push(' ');
        index++;
        state = 'code';
      }

      continue;
    }

    if (state === 'string' || state === 'character') {
      comments.push(char);
      literals.push(blank);

      if (char === '\\' && next !== undefined) {
        comments.push(next);
        literals.push(next === '\n' ? '\n' : ' ');
        index++;
      } else if (char === (state === 'string' ? '"' : "'")) {
        state = 'code';
      } else if (char === '\n') {
        fail(`Unterminated literal in "${path}".`);
      }

      continue;
    }

    if (char === '/' && (next === '/' || next === '*')) {
      comments.push(' ', ' ');
      literals.push(' ', ' ');
      index++;
      state = next === '/' ? 'line' : 'block';
    } else if (char === '"' || char === "'") {
      comments.push(char);
      literals.push(' ');
      state = char === '"' ? 'string' : 'character';
    } else {
      comments.push(char);
      literals.push(char);
    }
  }

  if (state === 'block' || state === 'string' || state === 'character') {
    fail(`Unterminated comment or literal in "${path}".`);
  }

  return { commentsRemoved: comments.join(''), literalsRemoved: literals.join('') };
}

/**
 * A deliberately limited source-policy screen, NOT a C parser, preprocessor or security boundary.
 * It does not prove C17 validity, expand macros or establish runtime safety. A real strict C17
 * compiler AND an isolated, resource-limited OS sandbox for compilation/execution are mandatory.
 * Standard C itself can access files, allocate memory and launch processes; flags are not isolation.
 */
function checkSourcePolicy(source: string, path: string, files: Record<string, string>): void {
  if (source.includes('\0') || source.includes('\u0001')) {
    fail(`Source "${path}" contains an unsupported control character.`);
  }

  const logical = logicalSource(source);
  const masks = lexicalMasks(logical.text, path);
  const codeLines = masks.literalsRemoved.split('\n');
  const operandLines = masks.commentsRemoved.split('\n');
  const banned =
    /\b(?:__asm__|__asm|asm|__typeof__|__typeof|typeof|__builtin_[A-Za-z0-9_]*|__attribute__|__attribute|__declspec|__extension__)\b/;

  if (/\b_Pragma\b/.test(masks.literalsRemoved) || /##|%:%:/.test(masks.literalsRemoved)) {
    fail(`Compiler pragmas and macro token-pasting are forbidden by source policy in "${path}".`);
  }

  const extension = masks.literalsRemoved.match(banned);

  if (extension) {
    fail(`Non-C17 extension token "${extension[0]}" in "${path}".`);
  }

  for (let line = 0; line < codeLines.length; line++) {
    const code = codeLines[line];

    if (/^\s*%:/.test(code)) {
      fail(`Digraph preprocessing directives are unsupported in "${path}".`);
    }

    if (!/^\s*#/.test(code)) {
      continue;
    }

    if (logical.trigraphLines.has(line)) {
      fail(`Trigraph preprocessing directives are unsupported in "${path}".`);
    }

    if (logical.splicedLines.has(line)) {
      fail(`Backslash line-splices in preprocessing directives are unsupported in "${path}".`);
    }

    const directive = code.match(/^\s*#\s*([A-Za-z_][A-Za-z0-9_]*)?/);
    const name = directive?.[1] ?? '';

    if (
      !['', 'include', 'define', 'undef', 'if', 'ifdef', 'ifndef', 'elif', 'else', 'endif', 'error', 'line'].includes(
        name,
      )
    ) {
      fail(`Unsupported preprocessing directive "#${name}" in "${path}" (no pragmas or platform directives).`);
    }

    if (name !== 'include') {
      continue;
    }

    const operand = operandLines[line].replace(/^\s*#\s*include\b/, '').trim();
    const angle = operand.match(/^<([^<>]+)>$/);
    const quoted = operand.match(/^"([^"\r\n]+)"$/);

    if (angle) {
      if (!standardHeaders.has(angle[1])) {
        fail(`Only C17 standard angle headers are allowed: "${angle[1]}" in "${path}".`);
      }
    } else if (quoted) {
      const includePath = quoted[1];
      checkPath(includePath, true);

      const slash = path.lastIndexOf('/');
      const resolved = slash === -1 ? includePath : `${path.slice(0, slash + 1)}${includePath}`;

      if (!owns(files, resolved)) {
        fail(`Local header "${includePath}" in "${path}" must exist at project path "${resolved}".`);
      }
    } else {
      fail(`Include in "${path}" must be a literal <C17-header.h> or "relative-local.h"; no macro includes.`);
    }
  }
}

/** Validate and copy data; inherited Object.prototype properties are never project keys. */
export function validateCProject(input: unknown): CProject {
  const project = record(input, 'Project');

  for (const key of Object.keys(project)) {
    if (key !== 'files' && key !== 'stdin') {
      fail(`Unknown project key "${key}"; compiler flags, scripts and extra options are forbidden.`);
    }
  }

  if (!owns(project, 'files')) {
    fail('Project requires its own files object.');
  }

  const sourceFiles = record(project.files, 'files');
  const paths = Object.keys(sourceFiles);

  if (paths.length === 0 || paths.length > C_PROJECT_LIMITS.maxFiles) {
    fail(`Project must contain 1–${C_PROJECT_LIMITS.maxFiles} files.`);
  }

  const files: Record<string, string> = Object.create(null);
  const spellings = new Map<string, string>();
  const filePaths = new Set(paths);
  let sourceBytes = 0;

  for (const path of paths) {
    checkPath(path);

    const segments = path.split('/');

    for (let end = 1; end <= segments.length; end++) {
      const prefix = segments.slice(0, end).join('/');
      const folded = prefix.toLowerCase();
      const prior = spellings.get(folded);

      if (prior !== undefined && prior !== prefix) {
        fail(`Case-colliding paths "${prior}" and "${prefix}".`);
      }

      spellings.set(folded, prefix);

      if (end < segments.length && filePaths.has(prefix)) {
        fail(`File/directory collision at "${prefix}".`);
      }
    }

    const source = checkText(sourceFiles[path], `File "${path}"`);
    sourceBytes += encoder.encode(source).byteLength;

    if (sourceBytes > C_PROJECT_LIMITS.maxSourceBytes) {
      fail('Total source exceeds 256 KiB of UTF-8 data.');
    }

    files[path] = source;
  }

  if (!paths.some((path) => path.endsWith('.c'))) {
    fail('Project requires at least one .c translation unit.');
  }

  const result: CProject = { files };

  if (owns(project, 'stdin')) {
    const stdin = checkText(project.stdin, 'stdin');

    if (encoder.encode(stdin).byteLength > C_PROJECT_LIMITS.maxStdinBytes) {
      fail('stdin exceeds 8 KiB of UTF-8 data.');
    }

    result.stdin = stdin;
  }

  for (const path of paths) {
    checkSourcePolicy(files[path], path, files);
  }

  return result;
}

/** Exact contents, ASCII-sorted paths, and optional stdin; absent stdin differs from explicit empty stdin. */
export function canonicalSerializeCProject(input: unknown): string {
  const project = validateCProject(input);
  const files: Record<string, string> = Object.create(null);

  for (const path of Object.keys(project.files).sort()) {
    files[path] = project.files[path];
  }

  return JSON.stringify(project.stdin === undefined ? { files } : { files, stdin: project.stdin });
}

/** Browser-safe SHA-256. Host code may hash the same canonical UTF-8 serialization with Node crypto. */
export async function hashCProject(input: unknown): Promise<string> {
  const canonical = canonicalSerializeCProject(input);

  if (!globalThis.crypto?.subtle) {
    fail('SHA-256 requires Web Crypto in a secure context; no insecure hash fallback.');
  }

  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(canonical));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseOpeningTag(
  text: string,
  offset: number,
  name: 'boltArtifact' | 'boltAction',
  allowed: readonly string[],
): { attributes: Record<string, string>; end: number } {
  const prefix = `<${name}`;

  if (!text.startsWith(prefix, offset)) {
    fail(`Expected a complete <${name}> opening tag.`);
  }

  let cursor = offset + prefix.length;
  const attributes: Record<string, string> = Object.create(null);

  while (cursor < text.length) {
    if (text[cursor] === '>') {
      for (const key of allowed) {
        if (!owns(attributes, key) || attributes[key].length === 0) {
          fail(`<${name}> requires a nonempty ${key} attribute.`);
        }
      }

      return { attributes, end: cursor + 1 };
    }

    const match = text.slice(cursor).match(/^\s+([A-Za-z][A-Za-z0-9]*)="([^"<>&\r\n]*)"/);

    if (!match) {
      const trailingSpace = text.slice(cursor).match(/^\s+>/);

      if (trailingSpace) {
        cursor += trailingSpace[0].length - 1;
        continue;
      }

      fail(`Malformed <${name}> attributes: use exact double-quoted attributes, without entities.`);
    }

    const [, key, value] = match;

    if (!allowed.includes(key) || owns(attributes, key)) {
      fail(`Unknown or duplicate <${name}> attribute "${key}".`);
    }

    attributes[key] = value;
    cursor += match[0].length;
  }

  return fail(`Incomplete <${name}> opening tag.`);
}

/**
 * Strict complete protocol, intentionally not a permissive streaming parser or general XML parser.
 * Accept exactly one artifact, whitespace outside it, and only complete file actions. Source bytes
 * are retained verbatim (no trim, fence conversion, entity decoding, repair or invented main.c).
 * Structural <bolt... tags are reserved even inside source comments/strings to avoid ambiguity.
 * Streaming callers must wait for completion and post-validate the entire assembled project.
 */
export function parseCArtifactComplete(text: string): CProject {
  if (typeof text !== 'string') {
    fail('Model response must be a string.');
  }

  if (encoder.encode(text).byteLength > C_PROJECT_LIMITS.maxSourceBytes + 64 * 1024) {
    fail('Model response exceeds the bounded artifact envelope.');
  }

  const message = text.trim();
  const artifact = parseOpeningTag(message, 0, 'boltArtifact', ['id', 'title']);

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(artifact.attributes.id) || artifact.attributes.title.length > 256) {
    fail('Artifact id must be safe ASCII (1–64 characters), and title at most 256 characters.');
  }

  const files: Record<string, string> = Object.create(null);
  let cursor = artifact.end;

  while (cursor < message.length) {
    while (/\s/.test(message[cursor] ?? '') && cursor < message.length) {
      cursor++;
    }

    if (message.startsWith('</boltArtifact>', cursor)) {
      cursor += '</boltArtifact>'.length;

      if (message.slice(cursor).trim() !== '') {
        fail('Only one complete artifact is allowed, with no trailing actions, markup or prose.');
      }

      return validateCProject({ files });
    }

    const action = parseOpeningTag(message, cursor, 'boltAction', ['type', 'filePath']);

    if (action.attributes.type !== 'file') {
      fail('Only file actions are allowed; shell and unknown actions are forbidden.');
    }

    const path = action.attributes.filePath;
    checkPath(path);

    if (owns(files, path)) {
      fail(`Duplicate file action "${path}".`);
    }

    if (Object.keys(files).length >= C_PROJECT_LIMITS.maxFiles) {
      fail('Artifact exceeds 32 file actions.');
    }

    const close = message.indexOf('</boltAction>', action.end);

    if (close === -1) {
      fail(`Incomplete file action "${path}"; never execute truncated model output.`);
    }

    const content = message.slice(action.end, close);

    if (/<\/?bolt/i.test(content)) {
      fail(`Nested, malformed or reserved protocol markup in file action "${path}".`);
    }

    files[path] = content;
    cursor = close + '</boltAction>'.length;
  }

  return fail('Incomplete artifact: missing </boltArtifact>.');
}

/** Alias for callers extracting a project from a completed model message; no fenced-code fallback. */
export const extractCProjectFromMessage = parseCArtifactComplete;

/** Parent UI/server contract: canonical UTF-8 serialization for hashing execution receipts. */
export const canonicalCProject = canonicalSerializeCProject;
