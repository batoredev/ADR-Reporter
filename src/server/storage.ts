import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

// Uploaded documents and approved PDFs are kept in the database (StoredFile),
// so the app needs no disk and runs as a Supabase Edge Function. Files are only
// served through routes that check the signed-in user's access to the case.
const KEY = /^(uploads|pdfs)\/[0-9a-f-]{36}\.(png|jpg|pdf)$/;
const MIME = { png: "image/png", jpg: "image/jpeg", pdf: "application/pdf" } as const;

/** Saves a file once; pass the transaction client to make the save part of a transaction. */
export async function saveFile(
  folder: "uploads" | "pdfs",
  extension: "png" | "jpg" | "pdf",
  bytes: Uint8Array,
  client: Prisma.TransactionClient | typeof db = db,
) {
  const key = `${folder}/${randomUUID()}.${extension}`;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await client.storedFile.create({
    data: { key, mimeType: MIME[extension], sizeBytes: bytes.length, sha256, bytes: new Uint8Array(bytes) },
  });
  return { key, sha256 };
}

export async function readStoredFile(key: string): Promise<Buffer> {
  if (!KEY.test(key)) throw new Error("Invalid storage key");
  const file = await db.storedFile.findUnique({ where: { key }, select: { bytes: true } });
  if (!file) throw new Error(`Stored file not found: ${key}`);
  return Buffer.from(file.bytes);
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
