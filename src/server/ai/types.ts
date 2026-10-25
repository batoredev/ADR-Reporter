import "server-only";
import type { Extraction } from "@/lib/domain/extraction";

export type ExtractionMimeType = "image/png" | "image/jpeg" | "application/pdf";

export interface AiProvider {
  /** Provider name as configured, e.g. "anthropic". Recorded with every extraction. */
  name: string;
  /** Model identifier as configured. Recorded with every extraction. */
  model: string;
  extractMedications(input: {
    bytes: Buffer;
    mimeType: ExtractionMimeType;
  }): Promise<{ output: Extraction; raw: unknown }>;
}

/** A failure the reporter should see (service refused, key rejected, unreadable reply). */
export class AiError extends Error {}
