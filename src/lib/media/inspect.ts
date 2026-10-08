/**
 * Pure byte-level inspection of uploaded media: real type from the file
 * signature (never the browser-declared MIME), image dimensions read from
 * headers without decoding pixels, and lossless metadata stripping.
 */

export type SniffedType = "image/jpeg" | "image/png" | "image/webp" | "audio/mpeg" | "audio/wav" | "video/mp4";

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));

export function sniffType(b: Uint8Array): SniffedType | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a)
    return "image/png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return "audio/wav";
  if (ascii(b, 0, 3) === "ID3") return "audio/mpeg";
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) return "audio/mpeg";
  if (ascii(b, 4, 4) === "ftyp") return "video/mp4";
  return null;
}

export interface ImageInfo {
  width: number;
  height: number;
  /** EXIF orientation (1 = normal), JPEG only. */
  orientation: number;
}

const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const le16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const le24 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const le32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegSegments(b: Uint8Array): Array<{ marker: number; start: number; end: number }> {
  const segments: Array<{ marker: number; start: number; end: number }> = [];
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) throw new Error("corrupt_jpeg");
    const marker = b[o + 1];
    if (marker === 0xff) {
      o += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      segments.push({ marker, start: o, end: b.length });
      break;
    }
    const len = be16(b, o + 2);
    if (len < 2 || o + 2 + len > b.length) throw new Error("corrupt_jpeg");
    segments.push({ marker, start: o, end: o + 2 + len });
    o += 2 + len;
  }
  return segments;
}

function exifOrientation(b: Uint8Array, start: number, end: number): number {
  // APP1 payload: "Exif\0\0" + TIFF header
  const tiff = start + 4 + 6;
  if (ascii(b, start + 4, 4) !== "Exif" || tiff + 8 > end) return 1;
  const little = ascii(b, tiff, 2) === "II";
  const r16 = (o: number) => (little ? le16(b, o) : be16(b, o));
  const r32 = (o: number) => (little ? le32(b, o) : be32(b, o));
  const ifd = tiff + r32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const count = r16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    if (r16(entry) === 0x0112) {
      const v = r16(entry + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

export function readImageInfo(b: Uint8Array, type: SniffedType): ImageInfo {
  if (type === "image/png") {
    if (ascii(b, 12, 4) !== "IHDR") throw new Error("corrupt_png");
    return { width: be32(b, 16), height: be32(b, 20), orientation: 1 };
  }
  if (type === "image/jpeg") {
    let orientation = 1;
    for (const s of jpegSegments(b)) {
      if (s.marker === 0xe1) orientation = Math.max(orientation, exifOrientation(b, s.start, s.end));
      if (SOF_MARKERS.has(s.marker)) {
        return { height: be16(b, s.start + 5), width: be16(b, s.start + 7), orientation };
      }
    }
    throw new Error("corrupt_jpeg");
  }
  if (type === "image/webp") {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8X") return { width: le24(b, 24) + 1, height: le24(b, 27) + 1, orientation: 1 };
    if (chunk === "VP8 ") return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff, orientation: 1 };
    if (chunk === "VP8L") {
      const bits = le32(b, 21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, orientation: 1 };
    }
    throw new Error("corrupt_webp");
  }
  throw new Error("not_an_image");
}

const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);
const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]); // APP1 (EXIF/XMP), APP13 (IPTC), COM

/** Removes EXIF/XMP/text metadata without re-encoding pixels. */
export function stripMetadata(b: Uint8Array, type: SniffedType): Uint8Array {
  if (type === "image/jpeg") {
    const parts: Uint8Array[] = [b.subarray(0, 2)];
    for (const s of jpegSegments(b)) {
      if (!JPEG_DROP.has(s.marker)) parts.push(b.subarray(s.start, s.end));
    }
    return concat(parts);
  }
  if (type === "image/png") {
    const parts: Uint8Array[] = [b.subarray(0, 8)];
    let o = 8;
    while (o + 12 <= b.length) {
      const len = be32(b, o);
      const kind = ascii(b, o + 4, 4);
      const end = o + 12 + len;
      if (end > b.length) throw new Error("corrupt_png");
      if (!PNG_DROP.has(kind)) parts.push(b.subarray(o, end));
      o = end;
      if (kind === "IEND") break;
    }
    return concat(parts);
  }
  if (type === "image/webp") {
    const parts: Uint8Array[] = [];
    let o = 12;
    while (o + 8 <= b.length) {
      const kind = ascii(b, o, 4);
      const len = le32(b, o + 4);
      const end = o + 8 + len + (len % 2);
      if (o + 8 + len > b.length) throw new Error("corrupt_webp");
      if (kind !== "EXIF" && kind !== "XMP ") {
        const chunk = b.slice(o, Math.min(end, b.length));
        if (kind === "VP8X") chunk[8] &= ~(0x08 | 0x04);
        parts.push(chunk);
      }
      o = end;
    }
    const body = concat(parts);
    const out = new Uint8Array(12 + body.length);
    out.set(b.subarray(0, 12));
    out.set(body, 12);
    const size = out.length - 8;
    out[4] = size & 0xff;
    out[5] = (size >> 8) & 0xff;
    out[6] = (size >> 16) & 0xff;
    out[7] = (size >>> 24) & 0xff;
    return out;
  }
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const IMAGE_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  minSide: 256,
  maxSide: 8192,
  maxPixels: 40_000_000,
};

export const AUDIO_LIMITS = {
  maxBytes: 25 * 1024 * 1024,
  minDurationMs: 500,
};

/** ffmpeg filter that bakes an EXIF orientation into the pixels. */
export function orientationFilter(orientation: number): string | null {
  return (
    {
      2: "hflip",
      3: "hflip,vflip",
      4: "vflip",
      5: "transpose=0",
      6: "transpose=1",
      7: "transpose=3",
      8: "transpose=2",
    } as Record<number, string>
  )[orientation] ?? null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
}
