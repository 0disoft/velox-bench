import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const width = 16;
const height = 16;
const bitmapHeaderBytes = 40;
const pixelBytes = width * height * 4;
const maskBytes = height * 4;
const imageBytes = bitmapHeaderBytes + pixelBytes + maskBytes;
const imageOffset = 6 + 16;

export function createTauriIcon(): Uint8Array {
  const bytes = new Uint8Array(imageOffset + imageBytes);
  const view = new DataView(bytes.buffer);

  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);
  bytes[6] = width;
  bytes[7] = height;
  view.setUint16(10, 1, true);
  view.setUint16(12, 32, true);
  view.setUint32(14, imageBytes, true);
  view.setUint32(18, imageOffset, true);

  view.setUint32(imageOffset, bitmapHeaderBytes, true);
  view.setInt32(imageOffset + 4, width, true);
  view.setInt32(imageOffset + 8, height * 2, true);
  view.setUint16(imageOffset + 12, 1, true);
  view.setUint16(imageOffset + 14, 32, true);
  view.setUint32(imageOffset + 20, pixelBytes, true);

  const pixels = imageOffset + bitmapHeaderBytes;
  for (let offset = pixels; offset < pixels + pixelBytes; offset += 4) {
    bytes[offset] = 0xd9;
    bytes[offset + 1] = 0x74;
    bytes[offset + 2] = 0x1f;
    bytes[offset + 3] = 0xff;
  }
  return bytes;
}

if (import.meta.main) {
  const output = process.argv[2];
  if (!output) throw new Error("usage: bun scripts/tauri-icon.ts <output.ico>");
  const path = resolve(output);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, createTauriIcon());
  console.log(JSON.stringify({ output: path, bytes: imageOffset + imageBytes }));
}
