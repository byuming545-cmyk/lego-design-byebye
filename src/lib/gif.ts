/** Minimal GIF89a encoder used for real canvas captures; no external runtime dependency. */
export interface GifFrame {
  width: number;
  height: number;
  /** RGBA bytes, row-major. */
  pixels: Uint8ClampedArray;
  delayCs?: number;
}

const LEVELS = [0, 51, 102, 153, 204, 255];
const PALETTE = new Uint8Array(768);
for (let r = 0; r < 6; r++) {
  for (let g = 0; g < 6; g++) {
    for (let b = 0; b < 6; b++) {
      const i = (r * 36 + g * 6 + b) * 3;
      PALETTE[i] = LEVELS[r]; PALETTE[i + 1] = LEVELS[g]; PALETTE[i + 2] = LEVELS[b];
    }
  }
}
const nearest = (value: number) => Math.max(0, Math.min(5, Math.round(value / 51)));

function indicesFor(frame: GifFrame): Uint8Array {
  const out = new Uint8Array(frame.width * frame.height);
  for (let i = 0; i < out.length; i++) {
    const p = i * 4;
    if (frame.pixels[p + 3] < 128) { out[i] = 0; continue; }
    out[i] = nearest(frame.pixels[p]) * 36 + nearest(frame.pixels[p + 1]) * 6 + nearest(frame.pixels[p + 2]);
  }
  return out;
}

class ByteWriter {
  private bytes: number[] = [];
  push(...values: number[]) { for (const value of values) this.bytes.push(value & 0xff); }
  ascii(value: string) { for (const char of value) this.push(char.charCodeAt(0)); }
  toUint8Array() { return Uint8Array.from(this.bytes); }
}

function lzw(indices: Uint8Array): Uint8Array {
  const clear = 256, end = 257;
  let codeSize = 9, next = 258;
  let dictionary = new Map<string, number>();
  const out: number[] = [];
  let bit = 0, accumulator = 0;
  const write = (code: number) => {
    accumulator |= code << bit;
    bit += codeSize;
    while (bit >= 8) { out.push(accumulator & 0xff); accumulator >>= 8; bit -= 8; }
  };
  write(clear);
  let prefix = indices[0] ?? 0;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = `${prefix},${k}`;
    const found = dictionary.get(key);
    if (found !== undefined) { prefix = found; continue; }
    write(prefix);
    dictionary.set(key, next++);
    if (next === (1 << codeSize) && codeSize < 12) codeSize++;
    if (next >= 4096) { write(clear); dictionary = new Map(); codeSize = 9; next = 258; }
    prefix = k;
  }
  write(prefix);
  write(end);
  if (bit > 0) out.push(accumulator & 0xff);
  const blocks: number[] = [];
  for (let i = 0; i < out.length; i += 255) {
    const slice = out.slice(i, i + 255);
    blocks.push(slice.length, ...slice);
  }
  blocks.push(0);
  return Uint8Array.from(blocks);
}

/** Encodes RGBA frames into a looping GIF89a. The fixed 6×6×6 palette is deliberately small. */
export function encodeGif(frames: GifFrame[]): Uint8Array {
  if (!frames.length) throw new Error('GIF 至少需要一帧。');
  const width = frames[0].width, height = frames[0].height;
  if (!width || !height) throw new Error('GIF 帧尺寸无效。');
  const header = new ByteWriter();
  header.ascii('GIF89a');
  header.push(width & 0xff, width >> 8, height & 0xff, height >> 8, 0xf7, 0, 0);
  header.push(...PALETTE);
  header.push(0x21, 0xff, 0x0b);
  header.ascii('NETSCAPE2.0');
  header.push(0x03, 0x01, 0x00, 0x00, 0x00);
  for (const frame of frames) {
    if (frame.width !== width || frame.height !== height) throw new Error('GIF 帧尺寸必须一致。');
    const delay = Math.max(2, frame.delayCs ?? 8);
    header.push(0x21, 0xf9, 0x04, 0x04, delay & 0xff, delay >> 8, 0x00, 0x00);
    header.push(0x2c, 0x00, 0x00, 0x00, 0x00, width & 0xff, width >> 8, height & 0xff, height >> 8, 0x00, 0x08);
    const data = lzw(indicesFor(frame));
    header.push(...data);
  }
  header.push(0x3b);
  return header.toUint8Array();
}
