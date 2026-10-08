import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readImageInfo, sniffType, stripMetadata } from "@/lib/media/inspect";

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));

/** Builds a JPEG with an EXIF APP1 segment carrying orientation=6 and a GPS-ish string. */
function jpegWithExif(): Uint8Array {
  const jpeg = fixture("portrait.jpg");
  const tiff = [
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // MM, 42, IFD at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, // orientation = 6
    0x00, 0x00, 0x00, 0x00,
  ];
  const secret = Array.from(new TextEncoder().encode("GPS-SECRET-LOCATION"));
  const payload = [...Array.from(new TextEncoder().encode("Exif\0\0")), ...tiff, ...secret];
  const len = payload.length + 2;
  const app1 = [0xff, 0xe1, len >> 8, len & 0xff, ...payload];
  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(jpeg.subarray(0, 2));
  out.set(app1, 2);
  out.set(jpeg.subarray(2), 2 + app1.length);
  return out;
}

describe("media inspection", () => {
  it("detects the real type from signatures, not names", () => {
    expect(sniffType(fixture("portrait.png"))).toBe("image/png");
    expect(sniffType(fixture("portrait.jpg"))).toBe("image/jpeg");
    expect(sniffType(fixture("voice.wav"))).toBe("audio/wav");
    expect(sniffType(fixture("voice.mp3"))).toBe("audio/mpeg");
    expect(sniffType(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffType(new Uint8Array(readFileSync("public/demo/sample.mp4")))).toBe("video/mp4");
  });

  it("reads dimensions from headers", () => {
    expect(readImageInfo(fixture("portrait.png"), "image/png")).toMatchObject({ width: 640, height: 640 });
    expect(readImageInfo(fixture("portrait.jpg"), "image/jpeg")).toMatchObject({ width: 640, height: 640, orientation: 1 });
  });

  it("reads EXIF orientation and strips EXIF without touching pixels", () => {
    const withExif = jpegWithExif();
    expect(readImageInfo(withExif, "image/jpeg").orientation).toBe(6);
    const stripped = stripMetadata(withExif, "image/jpeg");
    expect(Buffer.from(stripped).includes(Buffer.from("GPS-SECRET-LOCATION"))).toBe(false);
    expect(Buffer.from(stripped).equals(Buffer.from(stripMetadata(fixture("portrait.jpg"), "image/jpeg")))).toBe(true);
    expect(readImageInfo(stripped, "image/jpeg")).toMatchObject({ width: 640, height: 640, orientation: 1 });
  });

  it("strips PNG text chunks", () => {
    const png = fixture("portrait.png");
    // insert a tEXt chunk after IHDR (8 + 25 bytes)
    const data = new TextEncoder().encode("Comment\0private");
    const chunk = new Uint8Array(12 + data.length);
    new DataView(chunk.buffer).setUint32(0, data.length);
    chunk.set(new TextEncoder().encode("tEXt"), 4);
    chunk.set(data, 8);
    const withText = new Uint8Array(png.length + chunk.length);
    withText.set(png.subarray(0, 33));
    withText.set(chunk, 33);
    withText.set(png.subarray(33), 33 + chunk.length);
    const stripped = stripMetadata(withText, "image/png");
    expect(Buffer.from(stripped).equals(Buffer.from(png))).toBe(true);
  });
});
