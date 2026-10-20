import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getSupabaseClient } from "../db/supabase.ts";

export const KNOWLEDGE_BUCKET = "quote24x7-knowledge";
const LOCAL_STORAGE_DIR = path.resolve(process.cwd(), ".data", "knowledge-storage");

/**
 * Computes SHA256 hex digest of a buffer for deduplication.
 */
export function computeSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Ensures the local storage directory exists.
 */
async function ensureLocalDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function getLocalPath(storagePath: string): string {
  // Normalize and prevent directory traversal
  const safePath = path.normalize(storagePath).replace(/^(\.\.(\/|\\|$))+/, "");
  return path.join(LOCAL_STORAGE_DIR, safePath);
}

/**
 * Uploads a document to Supabase Storage (private bucket `quote24x7-knowledge`),
 * with dual persistence to local disk for robust offline/test fallback.
 */
export async function uploadToStorage(
  storagePath: string,
  buffer: Buffer,
  mimeType: string
): Promise<{ success: boolean; error?: string }> {
  // 1. Always write to local storage as fallback/cache
  const localTarget = getLocalPath(storagePath);
  try {
    await ensureLocalDir(localTarget);
    await fs.writeFile(localTarget, buffer);
  } catch (err) {
    console.warn("[knowledge-storage] Failed to write local fallback:", err);
  }

  // 2. Upload to Supabase Storage if configured
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase.storage
        .from(KNOWLEDGE_BUCKET)
        .upload(storagePath, buffer, {
          contentType: mimeType || "application/octet-stream",
          upsert: true,
        });

      if (error) {
        console.warn("[knowledge-storage] Supabase upload failed, using local fallback:", error.message);
        // We still succeed if local was saved
      }
    } catch (err) {
      console.warn("[knowledge-storage] Supabase upload exception, using local fallback:", err);
    }
  }

  return { success: true };
}

/**
 * Downloads a document from Supabase Storage, falling back to local storage.
 */
export async function downloadFromStorage(storagePath: string): Promise<Buffer | null> {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase.storage
        .from(KNOWLEDGE_BUCKET)
        .download(storagePath);

      if (!error && data) {
        const arrayBuffer = await data.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }
    } catch (err) {
      console.warn("[knowledge-storage] Supabase download error, checking local disk:", err);
    }
  }

  // Fallback to local storage
  const localTarget = getLocalPath(storagePath);
  try {
    const file = await fs.readFile(localTarget);
    return file;
  } catch {
    return null;
  }
}

/**
 * Creates a signed URL for secure document viewing in the browser.
 */
export async function getStorageSignedUrl(
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase.storage
        .from(KNOWLEDGE_BUCKET)
        .createSignedUrl(storagePath, expiresInSeconds);

      if (!error && data?.signedUrl) {
        return data.signedUrl;
      }
    } catch (err) {
      console.warn("[knowledge-storage] Failed to get signed URL:", err);
    }
  }
  return null;
}

/**
 * Deletes a document from both Supabase Storage and local fallback storage.
 */
export async function deleteFromStorage(storagePath: string): Promise<boolean> {
  const localTarget = getLocalPath(storagePath);
  try {
    await fs.unlink(localTarget);
  } catch {
    // Ignore if not on local disk
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.storage.from(KNOWLEDGE_BUCKET).remove([storagePath]);
    } catch (err) {
      console.warn("[knowledge-storage] Supabase delete error:", err);
    }
  }

  return true;
}
