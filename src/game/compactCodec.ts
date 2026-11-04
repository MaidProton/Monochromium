const MAX_CONTAINER_ITEMS = 50_000;
const MAX_STRING_BYTES = 2_000_000;
const MAX_DEPTH = 64;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

const encodeNumber = (value: number, output: number[]): void => {
  if (!Number.isFinite(value)) {
    output.push(0xc0);
    return;
  }
  if (Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff) {
    if (value < 0x80) output.push(value);
    else if (value <= 0xff) output.push(0xcc, value);
    else if (value <= 0xffff) output.push(0xcd, value >>> 8, value & 0xff);
    else output.push(0xce, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
    return;
  }
  if (Number.isInteger(value) && value >= -32 && value < 0) {
    output.push(value + 256);
    return;
  }
  if (Number.isInteger(value) && value >= -128 && value < 0) {
    output.push(0xd0, value + 256);
    return;
  }
  if (Number.isInteger(value) && value >= -32_768 && value < -128) {
    const normalized = value + 65_536;
    output.push(0xd1, normalized >>> 8, normalized & 0xff);
    return;
  }
  if (Number.isInteger(value) && value >= -2_147_483_648 && value < -32_768) {
    const normalized = value >>> 0;
    output.push(0xd2, (normalized >>> 24) & 0xff, (normalized >>> 16) & 0xff, (normalized >>> 8) & 0xff, normalized & 0xff);
    return;
  }
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value);
  output.push(0xcb, ...new Uint8Array(buffer));
};

const encodeValue = (value: unknown, output: number[], depth: number): void => {
  if (depth > MAX_DEPTH || value === undefined || value === null) {
    output.push(0xc0);
    return;
  }
  if (typeof value === "boolean") {
    output.push(value ? 0xc3 : 0xc2);
    return;
  }
  if (typeof value === "number") {
    encodeNumber(value, output);
    return;
  }
  if (typeof value === "string") {
    const encoded = utf8Encoder.encode(value);
    if (encoded.byteLength < 32) output.push(0xa0 | encoded.byteLength);
    else if (encoded.byteLength <= 0xff) output.push(0xd9, encoded.byteLength);
    else if (encoded.byteLength <= 0xffff) output.push(0xda, encoded.byteLength >>> 8, encoded.byteLength & 0xff);
    else output.push(0xdb, (encoded.byteLength >>> 24) & 0xff, (encoded.byteLength >>> 16) & 0xff, (encoded.byteLength >>> 8) & 0xff, encoded.byteLength & 0xff);
    output.push(...encoded);
    return;
  }
  if (Array.isArray(value)) {
    const length = Math.min(value.length, MAX_CONTAINER_ITEMS);
    if (length < 16) output.push(0x90 | length);
    else if (length <= 0xffff) output.push(0xdc, length >>> 8, length & 0xff);
    else output.push(0xdd, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff);
    for (let index = 0; index < length; index += 1) encodeValue(value[index], output, depth + 1);
    return;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).slice(0, MAX_CONTAINER_ITEMS);
    if (keys.length < 16) output.push(0x80 | keys.length);
    else if (keys.length <= 0xffff) output.push(0xde, keys.length >>> 8, keys.length & 0xff);
    else output.push(0xdf, (keys.length >>> 24) & 0xff, (keys.length >>> 16) & 0xff, (keys.length >>> 8) & 0xff, keys.length & 0xff);
    keys.forEach((key) => {
      encodeValue(key, output, depth + 1);
      encodeValue(value[key], output, depth + 1);
    });
    return;
  }
  output.push(0xc0);
};

export const encodeCompact = (value: unknown): Uint8Array => {
  const output: number[] = [];
  encodeValue(value, output, 0);
  return Uint8Array.from(output);
};

class Reader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get done(): boolean { return this.offset === this.bytes.byteLength; }

  private require(length: number): void {
    if (length < 0 || this.offset + length > this.bytes.byteLength) throw new Error("Truncated compact replication payload.");
  }

  private byte(): number {
    this.require(1);
    return this.bytes[this.offset++] ?? 0;
  }

  private length8(): number { return this.byte(); }
  private length16(): number { this.require(2); const value = this.view.getUint16(this.offset); this.offset += 2; return value; }
  private length32(): number { this.require(4); const value = this.view.getUint32(this.offset); this.offset += 4; return value; }

  value(depth = 0): unknown {
    if (depth > MAX_DEPTH) throw new Error("Compact replication payload is too deeply nested.");
    const tag = this.byte();
    if (tag <= 0x7f) return tag;
    if (tag >= 0xe0) return tag - 256;
    if ((tag & 0xe0) === 0xa0) return this.string(tag & 0x1f);
    if ((tag & 0xf0) === 0x90) return this.array(tag & 0x0f, depth);
    if ((tag & 0xf0) === 0x80) return this.map(tag & 0x0f, depth);
    switch (tag) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xcc: return this.byte();
      case 0xcd: return this.length16();
      case 0xce: return this.length32();
      case 0xd0: { const value = this.byte(); return value < 128 ? value : value - 256; }
      case 0xd1: { this.require(2); const value = this.view.getInt16(this.offset); this.offset += 2; return value; }
      case 0xd2: { this.require(4); const value = this.view.getInt32(this.offset); this.offset += 4; return value; }
      case 0xcb: { this.require(8); const value = this.view.getFloat64(this.offset); this.offset += 8; return value; }
      case 0xd9: return this.string(this.length8());
      case 0xda: return this.string(this.length16());
      case 0xdb: return this.string(this.length32());
      case 0xdc: return this.array(this.length16(), depth);
      case 0xdd: return this.array(this.length32(), depth);
      case 0xde: return this.map(this.length16(), depth);
      case 0xdf: return this.map(this.length32(), depth);
      default: throw new Error(`Unsupported compact replication tag 0x${tag.toString(16)}.`);
    }
  }

  private string(length: number): string {
    if (length > MAX_STRING_BYTES) throw new Error("Compact replication string is too large.");
    this.require(length);
    const value = utf8Decoder.decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  private array(length: number, depth: number): unknown[] {
    if (length > MAX_CONTAINER_ITEMS) throw new Error("Compact replication array is too large.");
    return Array.from({ length }, () => this.value(depth + 1));
  }

  private map(length: number, depth: number): Record<string, unknown> {
    if (length > MAX_CONTAINER_ITEMS) throw new Error("Compact replication map is too large.");
    const result = Object.create(null) as Record<string, unknown>;
    for (let index = 0; index < length; index += 1) {
      const key = this.value(depth + 1);
      if (typeof key !== "string") throw new Error("Compact replication map key is not a string.");
      result[key] = this.value(depth + 1);
    }
    return result;
  }
}

export const decodeCompact = (bytes: Uint8Array): unknown => {
  const reader = new Reader(bytes);
  const value = reader.value();
  if (!reader.done) throw new Error("Trailing bytes in compact replication payload.");
  return value;
};
