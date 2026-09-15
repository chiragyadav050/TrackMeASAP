/**
 * File storage boundary.
 *
 * PHASE 3 DEFINES THE INTERFACE ONLY. No provider is registered, no bucket
 * exists, no upload endpoint is exposed, and no UI offers file attachment.
 * The `Attachment` table stores metadata and nothing else.
 *
 * Why define it now rather than with the feature: several entities will want
 * attachments (syllabus PDFs on a subject, question papers on an exam,
 * submissions on an assignment), and `Attachment.entityType` is a plain
 * string precisely so the phase that adds a provider does not also have to
 * migrate every one of them. Pinning the contract here keeps that promise
 * honest.
 *
 * Same pattern as `src/services/ai/provider.ts`: the interface exists, the
 * implementation does not, and asking for one fails loudly rather than
 * silently doing nothing.
 *
 * LARGE FILES NEVER GO INTO POSTGRESQL. `storageKey` points at wherever the
 * bytes actually live.
 */

export type StoredObject = {
  /** Opaque key within the provider's namespace. */
  readonly key: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
};

export type UploadRequest = {
  /**
   * A pre-signed URL the browser uploads to directly.
   *
   * Uploads deliberately do NOT pass through the application server: routing
   * a 40 MB question paper through a Next.js route handler wastes memory and
   * gains nothing, and a pre-signed URL is the standard answer.
   */
  readonly uploadUrl: string;
  readonly key: string;
  /** Seconds until `uploadUrl` stops working. */
  readonly expiresInSeconds: number;
};

export interface StorageProvider {
  /** Stable identifier recorded on `Attachment.storageProvider`. */
  readonly id: string;

  /**
   * Issues a short-lived upload URL.
   *
   * `profileId` is part of the key namespace so one user's objects can never
   * collide with — or be guessed from — another's.
   */
  createUploadUrl(input: {
    readonly profileId: string;
    readonly fileName: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
  }): Promise<UploadRequest>;

  /** A short-lived URL for reading a stored object. */
  createDownloadUrl(key: string): Promise<string>;

  remove(key: string): Promise<void>;

  head(key: string): Promise<StoredObject | null>;
}

/**
 * Thrown until a provider is registered.
 *
 * Failing loudly — rather than accepting an upload and quietly dropping it —
 * is the point: a file the user believes is saved but is not would be worse
 * than no attachments at all.
 */
export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "No storage provider is configured. File attachments are not available yet.",
    );
    this.name = "StorageNotConfiguredError";
  }
}

let registered: StorageProvider | null = null;

/** Registration hook for whichever phase adds a real provider. */
export function registerStorageProvider(provider: StorageProvider): void {
  registered = provider;
}

export function isStorageConfigured(): boolean {
  return registered !== null;
}

export function getStorageProvider(): StorageProvider {
  if (!registered) {
    throw new StorageNotConfiguredError();
  }

  return registered;
}

/**
 * Limits any future provider must honour.
 *
 * Declared here rather than inside an implementation so the constraint is a
 * property of the system, not of whichever backend happens to be plugged in.
 */
export const STORAGE_LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  allowedMimeTypes: [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "text/plain",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
} as const;
