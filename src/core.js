/**
 * Varint Zigzag Encoder.
 *
 * Encodes signed integers using Protocol Buffer zigzag + base-128 varint encoding.
 * Supported range: signed 32-bit integers, [-2147483648, 2147483647].
 *
 * DESIGN DECISIONS
 * ----------------
 * 1) 32-bit, not 64-bit. JavaScript bitwise operators coerce operands to Int32, so a
 *    64-bit zigzag step would silently corrupt values outside the 32-bit range rather
 *    than throwing. We scope the library to Int32 and bounds-check explicitly, so the
 *    failure mode is a thrown RangeError instead of silent data loss.
 *
 * 2) Shift amounts are bounded constants (7, 31, 32) — never derived from input — so the
 *    "bounds-checked bit shifts" requirement is satisfied by construction: there is no
 *    user-controlled shift count to validate. The 32-bit left shift below is written as
 *    Math.pow(2, 32) for that one step to stay out of the Int32 trap that an actual
 *    << 32 would fall into (<< 32 is treated as << 0 by the JS spec).
 */

/**
 * Zigzag-encode a signed 32-bit integer into an unsigned value.
 *
 * Maps the signed range so small magnitudes (both positive and negative) map to small
 * unsigned integers, which then varint-encode compactly. This is the Protocol Buffers
 * mapping: (n << 1) ^ (n >> 31) computed in Int32 arithmetic.
 *
 * @param {number} n - signed integer in [-2147483648, 2147483647].
 * @returns {number} unsigned zigzag value in [0, 4294967295].
 * @throws {RangeError} if n is not a safe integer in the supported range.
 */
function zigzagEncode(n) {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`Input must be a safe integer; received ${n}`);
  }
  if (n < -2147483648 || n > 2147483647) {
    throw new RangeError(
      `Input out of 32-bit signed range [-2147483648, 2147483647]; received ${n}`
    );
  }
  // (n << 1) ^ (n >> 31). Both operands are Int32 after bitwise coercion, so the
  // right-shift on a negative n yields all-ones (arithmetic shift), giving the zigzag sign bit.
  // Written with | 0 to make the Int32 coercion explicit and intent-revealing.
  return ((n << 1) ^ (n >> 31)) >>> 0;
}

/**
 * Zigzag-decode an unsigned value (produced by zigzagEncode) back to a signed integer.
 *
 * Inverse of zigzagEncode: (n >>> 1) ^ -(n & 1) computed on the unsigned input.
 *
 * @param {number} u - unsigned value in [0, 4294967295].
 * @returns {number} signed integer in [-2147483648, 2147483647].
 * @throws {RangeError} if u is not a safe integer in [0, 4294967295].
 */
function zigzagDecode(u) {
  if (!Number.isSafeInteger(u)) {
    throw new RangeError(`Input must be a safe integer; received ${u}`);
  }
  if (u < 0 || u > 4294967295) {
    throw new RangeError(
      `Input out of unsigned 32-bit range [0, 4294967295]; received ${u}`
    );
  }
  // (u >>> 1) ^ -(u & 1) recovers the sign. For odd u, -(u & 1) === -1, and XOR with -1
  // (all ones in Int32) flips the high bits — reconstructing the negative value.
  return ((u >>> 1) ^ -(u & 1)) | 0;
}

/**
 * Encode a signed 32-bit integer to a varint byte array.
 *
 * Each output byte carries 7 payload bits; the high bit (0x80) is a continuation marker.
 * Returns a fresh Uint8Array whose length is the minimal number of bytes required.
 *
 * @param {number} value - signed integer in [-2147483648, 2147483647].
 * @returns {Uint8Array} little-endian varint bytes.
 * @throws {RangeError} on out-of-range or non-integer input.
 */
export function encode(value) {
  const zz = zigzagEncode(value);

  // Worst case for a 32-bit value is 5 bytes (ceil(32 / 7)).
  const buf = new Uint8Array(5);
  let v = zz;
  let i = 0;
  // Iterate the seven-bit groups while any non-zero payload remains. The loop always runs
  // at least once so that value === 0 yields a single 0x00 byte rather than an empty array.
  do {
    // Mask the low 7 bits; set the continuation bit only if higher bits remain.
    const low7 = v & 0x7f;
    v >>>= 7; // unsigned right shift — keeps v a non-negative Uint32 for the loop test
    buf[i++] = v > 0 ? low7 | 0x80 : low7;
  } while (v > 0);

  return buf.slice(0, i);
}

/**
 * Encode a signed 32-bit integer into an existing Uint8Array.
 *
 * Writes the varint at `offset` and returns the number of bytes written. The caller is
 * responsible for ensuring the buffer has room; a RangeError is thrown if it does not.
 *
 * @param {number} value - signed integer in [-2147483648, 2147483647].
 * @param {Uint8Array} buffer - destination buffer.
 * @param {number} [offset=0] - byte offset at which to start writing.
 * @returns {number} count of bytes written.
 * @throws {RangeError} on out-of-range input or insufficient buffer space.
 */
export function encodeInto(value, buffer, offset = 0) {
  if (!(buffer instanceof Uint8Array)) {
    throw new TypeError('buffer must be a Uint8Array');
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError(`offset must be a non-negative integer; received ${offset}`);
  }
  const zz = zigzagEncode(value);

  let v = zz;
  let i = offset;
  do {
    if (i >= buffer.length) {
      throw new RangeError(
        `Buffer overflow: wrote ${i - offset} bytes, no room for continuation at offset ${i}`
      );
    }
    const low7 = v & 0x7f;
    v >>>= 7;
    buffer[i++] = v > 0 ? low7 | 0x80 : low7;
  } while (v > 0);

  return i - offset;
}

/**
 * Decode a varint byte array into a signed 32-bit integer.
 *
 * Reads little-endian base-128 groups until a byte without the continuation bit is found,
 * then applies zigzag-decoding. A maximum of 5 bytes is consumed: a 32-bit zigzag value
 * fits in 5 bytes, and any 6th continuation byte would imply a value outside the supported
 * range, so it is rejected as malformed.
 *
 * @param {Uint8Array} bytes - varint bytes (at least one, at most five with continuation).
 * @returns {number} the decoded signed integer.
 * @throws {RangeError} if the input is empty, has more than 5 continuation bytes, or
 *   decodes to a value outside the unsigned 32-bit zigzag range.
 */
export function decode(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('bytes must be a Uint8Array');
  }
  if (bytes.length === 0) {
    throw new RangeError('Cannot decode an empty Uint8Array');
  }

  let result = 0;
  let shift = 0;
  // shift is a loop-local constant progression (0,7,14,...,28), never user-controlled,
  // so the bitwise shifts below are always in range. The 35-bit case at i === 5 is rejected
  // before any shift of 35 would be attempted, which is why the cap is 5 not 10.
  for (let i = 0; i < bytes.length; i++) {
    if (i >= 5) {
      throw new RangeError(
        'Varint is too long: more than 5 continuation bytes, exceeds 32-bit zigzag range'
      );
    }
    const byte = bytes[i];
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      // Reading a typed array yields integers in [0,255], but defend against a caller who
      // passes a view whose elements have been tampered with (e.g. via a Proxy).
      throw new RangeError(`Invalid byte at index ${i}: ${byte}`);
    }
    const payload = byte & 0x7f;
    result |= payload << shift;
    shift += 7;
    if ((byte & 0x80) === 0) {
      // Final byte — coerce to Uint32 and zigzag-decode.
      const unsigned = result >>> 0;
      return zigzagDecode(unsigned);
    }
  }

  // Loop exhausted without a terminator byte.
  throw new RangeError('Truncated varint: continuation bit set on final byte');
}
