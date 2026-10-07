import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, encodeInto } from '../src/index.js';

// Round-trip over a spread of values including both Int32 extremes, zero, and ±1.
// These cover every varint length class (1, 2, 3, 4, 5 bytes) and both sign branches.
const ROUND_TRIP_CASES = [
  0,
  1,
  -1,
  2,
  -2,
  63,
  64,
  -64,
  -65,
  8191,
  8192,
  -8192,
  -8193,
  1048575,
  1048576,
  -1048576,
  -1048577,
  134217727,
  134217728,
  -134217728,
  -134217729,
  2147483647,
  -2147483648,
];

test('encode produces a Uint8Array', () => {
  assert.ok(encode(0) instanceof Uint8Array);
});

test('encode(0) yields a single zero byte', () => {
  // Zero must still produce one byte — an empty varint is not a valid encoding of 0.
  assert.deepEqual(Array.from(encode(0)), [0x00]);
});

test('encode(1) zigzags to 2 then varints to a single byte 0x02', () => {
  assert.deepEqual(Array.from(encode(1)), [0x02]);
});

test('encode(-1) zigzags to 1 then varints to a single byte 0x01', () => {
  assert.deepEqual(Array.from(encode(-1)), [0x01]);
});

test('encode(64) produces a two-byte varint (boundary into 2-byte class)', () => {
  // zigzag(64) === 128 === 0b1000_0000 → low7=0 (cont), high7=1 (final)
  assert.deepEqual(Array.from(encode(64)), [0x80, 0x01]);
});

test('encode(-65) produces a two-byte varint', () => {
  // zigzag(-65) === 129 === 0b1000_0001 → low7=1 (cont), high7=1 (final)
  assert.deepEqual(Array.from(encode(-65)), [0x81, 0x01]);
});

test('encode(Int32 max) produces exactly five bytes', () => {
  // zigzag(2147483647) === 4294967294, which is 32 bits → ceil(32/7) = 5 bytes.
  assert.equal(encode(2147483647).length, 5);
});

test('encode(Int32 min) produces exactly five bytes', () => {
  // zigzag(-2147483648) === 4294967295, also 32 bits → 5 bytes.
  assert.equal(encode(-2147483648).length, 5);
});

test('round-trip preserves value across the Int32 range', () => {
  for (const value of ROUND_TRIP_CASES) {
    const bytes = encode(value);
    assert.equal(decode(bytes), value, `round-trip failed for ${value}`);
  }
});

test('decode rejects an empty Uint8Array', () => {
  assert.throws(() => decode(new Uint8Array(0)), RangeError);
});

test('decode rejects a truncated varint (continuation bit set on final byte)', () => {
  // 0x80 says "more bytes follow" but none do.
  assert.throws(() => decode(Uint8Array.from([0x80])), RangeError);
});

test('decode rejects a varint longer than 5 continuation bytes', () => {
  // Six bytes all with continuation set would encode at least 36 bits of payload,
  // which cannot live in a 32-bit zigzag value.
  const overlong = Uint8Array.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x00]);
  assert.throws(() => decode(overlong), RangeError);
});

test('decode of a 5-byte varint representing Int32 max round-trips', () => {
  const bytes = encode(2147483647);
  assert.equal(decode(bytes), 2147483647);
});

test('decode of a 5-byte varint representing Int32 min round-trips', () => {
  const bytes = encode(-2147483648);
  assert.equal(decode(bytes), -2147483648);
});

test('decode accepts extra trailing bytes only when the varint terminates first', () => {
  // A subtle correctness check: decode reads exactly the varint and ignores the rest.
  // We confirm this by appending a stray 0xff and checking the value still comes back.
  const bytes = Uint8Array.from([...encode(300), 0xff]);
  assert.equal(decode(bytes), 300);
});

test('encode rejects non-integer input', () => {
  assert.throws(() => encode(1.5), RangeError);
});

test('encode rejects input above Int32 max', () => {
  assert.throws(() => encode(2147483648), RangeError);
});

test('encode rejects input below Int32 min', () => {
  assert.throws(() => encode(-2147483649), RangeError);
});

test('encode rejects non-safe-integer input', () => {
  assert.throws(() => encode(Number.MAX_SAFE_INTEGER), RangeError);
});

test('encodeInto writes into a provided buffer and returns the byte count', () => {
  const buffer = new Uint8Array(8);
  const written = encodeInto(300, buffer, 0);
  // zigzag(300) === 600 → 0b10_0101_1000 → bytes [0xd8, 0x04]
  assert.equal(written, 2);
  assert.deepEqual(Array.from(buffer.slice(0, 2)), [0xd8, 0x04]);
});

test('encodeInto respects a non-zero offset and does not clobber preceding bytes', () => {
  const buffer = new Uint8Array(8).fill(0xab);
  const written = encodeInto(0, buffer, 3);
  assert.equal(written, 1);
  assert.equal(buffer[3], 0x00);
  assert.equal(buffer[4], 0xab); // untouched
});

test('encodeInto throws on insufficient buffer space', () => {
  const tiny = new Uint8Array(1);
  // zigzag(-2147483648) = 4294967295 needs 5 bytes; 1 byte is not enough.
  assert.throws(() => encodeInto(-2147483648, tiny, 0), RangeError);
});

test('encodeInto rejects a non-Uint8Array buffer', () => {
  assert.throws(() => encodeInto(0, []), TypeError);
});

test('encodeInto rejects a negative offset', () => {
  assert.throws(() => encodeInto(0, new Uint8Array(4), -1), RangeError);
});

test('decode rejects a non-Uint8Array input', () => {
  assert.throws(() => decode([0x00]), TypeError);
});
