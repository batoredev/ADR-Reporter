import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Private local storage outside the public web folder. Files are only served
// through routes that check the signed-in user's access to the case.
const ROOT = path.join(process.cwd(), "storage");
const KEY = /^(uploads|pdfs)\/[0-9a-f-]{36}\.(png|jpg|pdf)$/;

export async function saveFile(folder: "uploads" | "pdfs", extension: "png" | "jpg" | "pdf", bytes: Uint8Array) {
  const key = `${folder}/${randomUUID()}.${extension}`;
  await mkdir(path.join(ROOT, folder), { recursive: true });
  await writeFile(path.join(ROOT, key), bytes, { flag: "wx" });
  return { key, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function readStoredFile(key: string): Promise<Buffer> {
  if (!KEY.test(key)) throw new Error("Invalid storage key");
  return readFile(path.join(ROOT, key));
}

/** Detects the real file type from its first bytes; the file name is never trusted. */
export function sniffType(
  bytes: Uint8Array,
): { mimeType: "image/png" | "image/jpeg" | "application/pdf"; extension: "png" | "jpg" | "pdf" } | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return { mimeType: "image/png", extension: "png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { mimeType: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-")
    return { mimeType: "application/pdf", extension: "pdf" };
  return null;
}
