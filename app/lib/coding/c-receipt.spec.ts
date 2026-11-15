import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalCProject, validateCProject } from './c-project';
import { receiptMatchesProject } from './c-receipt';

describe('C receipt source and stdin binding', () => {
  const original = { files: { 'main.c': 'int main(void){return 0;}\n' }, stdin: 'A' };
  const receipt = { sourceHash: createHash('sha256').update(canonicalCProject(original)).digest('hex') };
  it('accepts only an actual hash matching exact current bytes and input', async () => {
    expect(await receiptMatchesProject(original, receipt)).toBe(true);
    expect(await receiptMatchesProject({ ...original, stdin: 'B' }, receipt)).toBe(false);
    expect(
      await receiptMatchesProject({ files: { 'main.c': 'int main(void){return 1;}\n' }, stdin: 'A' }, receipt),
    ).toBe(false);
    expect(await receiptMatchesProject(original, { sourceHash: 'invalid' })).toBe(false);
    expect(await receiptMatchesProject(original, undefined)).toBe(false);
  });
});

describe('compiler-policy bypasses', () => {
  it.each([
    '_Pragma("GCC diagnostic ignored \\"-Wpedantic\\"")\nint main(void){return ({int x=0;x;});}',
    '#define CAT(a,b) a##b\nint main(void){CAT(__as,m__)("nop");return 0;}',
    '#define CAT(a,b) a %:%: b\nint main(void){CAT(__as,m__)("nop");return 0;}',
    'int main(void){return __extension__ ({int x=0;x;});}',
  ])('rejects source that overrides the existing strict-C policy', (source) => {
    expect(() => validateCProject({ files: { 'main.c': source } })).toThrow(/pragma|token-pasting|Non-C17/i);
  });
  it('allows harmless literal/comments and ordinary portable object macros', () => {
    const source =
      '#define COUNT 3\n/* _Pragma ## __extension__ */\nconst char *s="_Pragma ##";\nint main(void){return COUNT-3;}\n';
    expect(validateCProject({ files: { 'main.c': source } }).files['main.c']).toBe(source);
  });
});
