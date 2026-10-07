# varint-zigzag

Encode and decode signed 32-bit integers using Protocol Buffer zigzag + base-128 varint encoding. Pure ESM, zero dependencies.

```js
import { encode, decode, encodeInto } from './src/index.js';

const bytes = encode(-2147483648);     // Uint8Array [0xff, 0xff, 0xff, 0xff, 0x0f]
const value = decode(bytes);           // -2147483648

const buf = new Uint8Array(16);
const written = encodeInto(300, buf, 0); // 2
```

## Why

Small signed integers are wasteful in a fixed-width int32: the value `-1` still costs four bytes. Zigzag maps signed values onto unsigned ones so small magnitudes stay small (`-1 → 1`, `1 → 2`, `-2 → 3`), and varint then emits only as many bytes as the magnitude needs — one byte for anything in `[-64, 63]`, two for `[-8192, 8191]`, up to five for the full 32-bit range. This is the encoding Protocol Buffers uses for `int32`/`sint32` fields.

The trade-off: this library is 32-bit only. JavaScript bitwise operators coerce to Int32, so a 64-bit variant would silently corrupt large values rather than throw. Scoping to Int32 and bounds-checking up front turns that silent corruption into a `RangeError`.

## Edge cases

- `encode(0)` returns a single `0x00` byte, not an empty array. An empty varint is not a valid encoding of zero.
- Input outside `[-2147483648, 2147483647]` (including `Number.MAX_SAFE_INTEGER`) throws `RangeError`. The library does not support 64-bit values.
- `decode` consumes at most 5 bytes and rejects a sixth continuation byte, since a 32-bit zigzag value cannot legitimately require one.
- `decode` on a truncated varint (continuation bit set on the final byte) throws `RangeError`.
- `decode` reads exactly one varint from the front of the buffer and ignores any trailing bytes; the caller decides whether leftovers are an error.
- `encodeInto` throws `RangeError` if the destination buffer cannot hold the full encoding.

## Exports

- `encode(value: number): Uint8Array` — encode a signed 32-bit integer to a fresh varint byte array.
- `decode(bytes: Uint8Array): number` — decode varint bytes back to a signed 32-bit integer.
- `encodeInto(value: number, buffer: Uint8Array, offset?: number): number` — write a varint into an existing buffer at `offset` (default 0), returning the number of bytes written.
