import assert from 'node:assert/strict';
import test from 'node:test';
import { readTraceCode } from './trace-code.ts';

const uid = 'b1029cf3-0246-4e38-8159-7c2422b0a001';
const code = 'a'.repeat(64);

test('reads a bare box code, in any letter case and with surrounding whitespace', () => {
  assert.deepEqual(readTraceCode(`  ${uid.toUpperCase()}\r\n`), { uid });
});

test('reads a bare secret code', () => {
  assert.deepEqual(readTraceCode(code.toUpperCase()), { code });
});

test('reads the box and secret code from a trace link fragment', () => {
  assert.deepEqual(readTraceCode(`https://example.test/trace#uid=${uid}&code=${code}`), { uid, code });
  assert.deepEqual(readTraceCode(`https://example.test/trace#uid=${uid}`), { uid, code: undefined });
});

test('reads a trace link that carries the box code in the query string', () => {
  assert.deepEqual(readTraceCode(`https://example.test/trace?uid=${uid}&source=qr`), { uid, code: undefined });
});

test('rejects unrelated QR content', () => {
  for (const text of ['', 'not-a-code', 'https://example.test', 'https://example.test/trace#uid=wrong', `ftp://example.test/#uid=${uid}`]) {
    assert.equal(readTraceCode(text), null);
  }
});
