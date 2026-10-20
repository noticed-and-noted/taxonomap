/**
 * Minimal MD5 (RFC 1321) over UTF-8 strings. GBIF's image cache addresses
 * thumbnails by the MD5 of the media identifier, and Web Crypto has no MD5.
 */

const BLOCK_BYTES = 64;
const ROUNDS = 64;
const WORDS_PER_BLOCK = 16;
const BYTES_PER_WORD = 4;
const PADDING_MARKER = 0x80;
const LENGTH_FIELD_BYTES = 8;

const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4,
  11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const CONSTANTS = Array.from(
  { length: ROUNDS },
  (_unused, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32) >>> 0,
);

type State = [stateA: number, stateB: number, stateC: number, stateD: number];

const INITIAL_STATE: State = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];

/** Pads the message to a whole number of 64-byte blocks and appends its bit length (RFC 1321 §3.1-3.2). */
function padMessage(bytes: Uint8Array): DataView {
  const length = bytes.length;
  const padded = new Uint8Array((((length + LENGTH_FIELD_BYTES) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[length] = PADDING_MARKER;

  const bitLength = length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - LENGTH_FIELD_BYTES, bitLength >>> 0, true);
  view.setUint32(padded.length - BYTES_PER_WORD, Math.floor(bitLength / 2 ** 32), true);
  return view;
}

/** The mixing function and message-word index for one round (RFC 1321 §3.4). */
function mixRound(round: number, [, stateB, stateC, stateD]: State): { mixed: number; wordIndex: number } {
  if (round < 16) return { mixed: (stateB & stateC) | (~stateB & stateD), wordIndex: round };
  if (round < 32) return { mixed: (stateD & stateB) | (~stateD & stateC), wordIndex: (5 * round + 1) % 16 };
  if (round < 48) return { mixed: stateB ^ stateC ^ stateD, wordIndex: (3 * round + 5) % 16 };
  return { mixed: stateC ^ (stateB | ~stateD), wordIndex: (7 * round) % 16 };
}

/** Runs the 64 rounds over one block, returning the block's contribution to the state. */
function processBlock(state: State, words: Uint32Array): State {
  let [stateA, stateB, stateC, stateD] = state;
  for (let round = 0; round < ROUNDS; round++) {
    const { mixed, wordIndex } = mixRound(round, [stateA, stateB, stateC, stateD]);
    const previousD = stateD;
    stateD = stateC;
    stateC = stateB;
    const sum = (stateA + mixed + (CONSTANTS[round] as number) + (words[wordIndex] as number)) >>> 0;
    const shift = SHIFTS[round] as number;
    stateB = (stateB + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0;
    stateA = previousD;
  }
  return [stateA, stateB, stateC, stateD];
}

/** Little-endian hex of the four state words. */
function toHex(state: State): string {
  let hex = '';
  for (const word of state) {
    for (let byteIndex = 0; byteIndex < BYTES_PER_WORD; byteIndex++) {
      hex += ((word >>> (byteIndex * 8)) & 0xff).toString(16).padStart(2, '0');
    }
  }
  return hex;
}

/**
 * MD5 digest of a string.
 * @param input Text to hash, encoded as UTF-8.
 * @returns The 32-character lowercase hex digest.
 */
export function md5(input: string): string {
  const view = padMessage(new TextEncoder().encode(input));
  const words = new Uint32Array(WORDS_PER_BLOCK);
  let state: State = [...INITIAL_STATE];

  for (let offset = 0; offset < view.byteLength; offset += BLOCK_BYTES) {
    for (let index = 0; index < WORDS_PER_BLOCK; index++) {
      words[index] = view.getUint32(offset + index * BYTES_PER_WORD, true);
    }
    const block = processBlock(state, words);
    state = state.map((word, index) => (word + block[index]!) >>> 0) as State;
  }
  return toHex(state);
}
