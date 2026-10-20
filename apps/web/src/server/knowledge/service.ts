import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getSupabaseClient } from "../db/supabase.ts";
import { uploadToStorage, downloadFromStorage, deleteFromStorage, computeSha256 } from "./storage.ts";
import { extractDocumentContent } from "./indexer.ts";
import type {
  KnowledgeDocument,
  KnowledgeChunk,
  KnowledgeCategory,
  KnowledgeDocumentStatus,
} from "@/types/domain";

const LOCAL_STORE_FILE = path.resolve(process.cwd(), ".data", "knowledge-store.json");

interface LocalKnowledgeStore {
  documents: KnowledgeDocument[];
  chunks: KnowledgeChunk[];
}

let memoryStore: LocalKnowledgeStore = {
  documents: [],
  chunks: [],
};

async function loadLocalStore(): Promise<LocalKnowledgeStore> {
  try {
    const raw = await fs.readFile(LOCAL_STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    memoryStore = {
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
      chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
    };
  } catch {
    // Keep in-memory
  }
  return memoryStore;
}

async function saveLocalStore(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(LOCAL_STORE_FILE), { recursive: true });
    await fs.writeFile(LOCAL_STORE_FILE, JSON.stringify(memoryStore, null, 2), "utf8");
  } catch {
    // Ignore
  }
}

// Pre-load on startup
void loadLocalStore();

/**
 * Lists documents with optional category, status, and text search filter.
 */
export async function listKnowledgeDocuments(filters?: {
  category?: string;
  status?: string;
  search?: string;
}): Promise<KnowledgeDocument[]> {
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      let query = supabase
        .from("knowledge_documents")
        .select("*")
        .order("created_at", { ascending: false });

      if (filters?.category && filters.category !== "all") {
        query = query.eq("category", filters.category);
      }
      if (filters?.status && filters.status !== "all") {
        query = query.eq("status", filters.status);
      }
      if (filters?.search?.trim()) {
        query = query.ilike("name", `%${filters.search.trim()}%`);
      }

      const { data, error } = await query;
      if (!error && data) {
        return data.map((d) => ({
          id: d.id,
          name: d.name,
          storagePath: d.storage_path,
          mimeType: d.mime_type,
          fileExtension: d.file_extension,
          fileSizeBytes: Number(d.file_size_bytes),
          sha256: d.sha256,
          category: d.category as KnowledgeCategory,
          version: d.version,
          status: d.status as KnowledgeDocumentStatus,
          pageCount: d.page_count,
          chunkCount: d.chunk_count,
          uploadedBy: d.uploaded_by,
          errorMessage: d.error_message,
          createdAt: d.created_at,
          updatedAt: d.updated_at,
          processedAt: d.processed_at,
        }));
      }
    } catch {
      // Fallback
    }
  }

  // Local fallback
  await loadLocalStore();
  return memoryStore.documents.filter((doc) => {
    if (filters?.category && filters.category !== "all" && doc.category !== filters.category) {
      return false;
    }
    if (filters?.status && filters.status !== "all" && doc.status !== filters.status) {
      return false;
    }
    if (filters?.search?.trim()) {
      const q = filters.search.trim().toLowerCase();
      return doc.name.toLowerCase().includes(q) || doc.category.toLowerCase().includes(q);
    }
    return true;
  });
}

/**
 * Retrieves a document by ID with its extracted chunks.
 */
export async function getKnowledgeDocument(
  id: string
): Promise<{ document: KnowledgeDocument; chunks: KnowledgeChunk[] } | null> {
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      const { data: docData, error: docError } = await supabase
        .from("knowledge_documents")
        .select("*")
        .eq("id", id)
        .single();

      if (!docError && docData) {
        const { data: chunksData } = await supabase
          .from("knowledge_chunks")
          .select("*")
          .eq("document_id", id)
          .order("chunk_index", { ascending: true });

        const document: KnowledgeDocument = {
          id: docData.id,
          name: docData.name,
          storagePath: docData.storage_path,
          mimeType: docData.mime_type,
          fileExtension: docData.file_extension,
          fileSizeBytes: Number(docData.file_size_bytes),
          sha256: docData.sha256,
          category: docData.category,
          version: docData.version,
          status: docData.status,
          pageCount: docData.page_count,
          chunkCount: docData.chunk_count,
          uploadedBy: docData.uploaded_by,
          errorMessage: docData.error_message,
          createdAt: docData.created_at,
          updatedAt: docData.updated_at,
          processedAt: docData.processed_at,
        };

        const chunks: KnowledgeChunk[] = (chunksData || []).map((c) => ({
          id: c.id,
          documentId: c.document_id,
          chunkIndex: c.chunk_index,
          content: c.content,
          pageNumber: c.page_number,
          sectionTitle: c.section_title,
          sourceMetadata: c.source_metadata || {},
          createdAt: c.created_at,
        }));

        return { document, chunks };
      }
    } catch {
      // Fallback
    }
  }

  // Local fallback
  await loadLocalStore();
  const doc = memoryStore.documents.find((d) => d.id === id);
  if (!doc) return null;
  const chunks = memoryStore.chunks
    .filter((c) => c.documentId === id)
    .sort((a, b) => a.chunkIndex - b.chunkIndex);

  return { document: doc, chunks };
}

/**
 * Checks if a document with the exact same content hash already exists.
 */
export async function findDuplicateDocument(sha256: string): Promise<KnowledgeDocument | null> {
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("knowledge_documents")
        .select("*")
        .eq("sha256", sha256)
        .neq("status", "archived")
        .limit(1);

      if (!error && data && data.length > 0 && data[0]) {
        const d = data[0];
        return {
          id: d.id,
          name: d.name,
          storagePath: d.storage_path,
          mimeType: d.mime_type,
          fileExtension: d.file_extension,
          fileSizeBytes: Number(d.file_size_bytes),
          sha256: d.sha256,
          category: d.category,
          version: d.version,
          status: d.status,
          pageCount: d.page_count,
          chunkCount: d.chunk_count,
          uploadedBy: d.uploaded_by,
          errorMessage: d.error_message,
          createdAt: d.created_at,
          updatedAt: d.updated_at,
          processedAt: d.processed_at,
        };
      }
    } catch {
      // Fallback
    }
  }

  await loadLocalStore();
  return memoryStore.documents.find((d) => d.sha256 === sha256 && d.status !== "archived") ?? null;
}

/**
 * Uploads, extracts, indexes, and persists a new knowledge document.
 */
export async function ingestKnowledgeDocument(params: {
  filename: string;
  buffer: Buffer;
  mimeType: string;
  category?: KnowledgeCategory;
  version?: number;
  uploadedBy?: string;
}): Promise<{ document: KnowledgeDocument; chunksCount: number; error?: string }> {
  const docId = crypto.randomUUID();
  const ext = params.filename.split(".").pop()?.toLowerCase() || "";
  const now = new Date().toISOString();
  const sha256 = computeSha256(params.buffer);
  const storagePath = `docs/${docId}/${params.filename}`;

  // 1. Upload original file to private storage
  const uploadRes = await uploadToStorage(storagePath, params.buffer, params.mimeType);
  if (!uploadRes.success) {
    throw new Error(`Failed to upload file to storage: ${uploadRes.error}`);
  }

  // 2. Initial document record with status "processing"
  const doc: KnowledgeDocument = {
    id: docId,
    name: params.filename,
    storagePath,
    mimeType: params.mimeType,
    fileExtension: ext,
    fileSizeBytes: params.buffer.length,
    sha256,
    category: params.category || "other",
    version: params.version || 1,
    status: "processing",
    pageCount: null,
    chunkCount: 0,
    uploadedBy: params.uploadedBy || null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    processedAt: null,
  };

  // 3. Extract text & chunks
  const extraction = await extractDocumentContent(params.buffer, params.filename, params.mimeType);

  if (!extraction.success) {
    doc.status = "failed";
    doc.errorMessage = extraction.error || "Failed to extract text from document.";
    doc.pageCount = extraction.pageCount;
    await persistDocument(doc, []);
    return { document: doc, chunksCount: 0, error: doc.errorMessage };
  }

  // 4. Create chunk records
  const chunks: KnowledgeChunk[] = extraction.chunks.map((draft) => ({
    id: crypto.randomUUID(),
    documentId: docId,
    chunkIndex: draft.chunkIndex,
    content: draft.content,
    pageNumber: draft.pageNumber,
    sectionTitle: draft.sectionTitle,
    sourceMetadata: draft.sourceMetadata,
    createdAt: now,
  }));

  doc.status = "ready";
  doc.pageCount = extraction.pageCount;
  doc.chunkCount = chunks.length;
  doc.processedAt = new Date().toISOString();

  // 5. Persist document & chunks
  await persistDocument(doc, chunks);

  return { document: doc, chunksCount: chunks.length };
}

/**
 * Persists document and chunks into Supabase Postgres (or local store fallback).
 */
async function persistDocument(doc: KnowledgeDocument, chunks: KnowledgeChunk[]): Promise<void> {
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      // Upsert document
      await supabase.from("knowledge_documents").upsert({
        id: doc.id,
        name: doc.name,
        storage_path: doc.storagePath,
        mime_type: doc.mimeType,
        file_extension: doc.fileExtension,
        file_size_bytes: doc.fileSizeBytes,
        sha256: doc.sha256,
        category: doc.category,
        version: doc.version,
        status: doc.status,
        page_count: doc.pageCount,
        chunk_count: doc.chunkCount,
        uploaded_by: doc.uploadedBy,
        error_message: doc.errorMessage,
        created_at: doc.createdAt,
        updated_at: doc.updatedAt,
        processed_at: doc.processedAt,
      });

      // Insert chunks if any
      if (chunks.length > 0) {
        // Delete previous chunks if re-indexing
        await supabase.from("knowledge_chunks").delete().eq("document_id", doc.id);

        const rows = chunks.map((c) => ({
          id: c.id,
          document_id: c.documentId,
          chunk_index: c.chunkIndex,
          content: c.content,
          page_number: c.pageNumber,
          section_title: c.sectionTitle,
          source_metadata: c.sourceMetadata,
          created_at: c.createdAt,
        }));

        // Batch insert in chunks of 50
        for (let i = 0; i < rows.length; i += 50) {
          const batch = rows.slice(i, i + 50);
          await supabase.from("knowledge_chunks").insert(batch);
        }
      }
      return;
    } catch (err) {
      console.warn("[knowledge] Supabase persistence error, falling back to local:", err);
    }
  }

  // Local fallback
  await loadLocalStore();
  const existingIdx = memoryStore.documents.findIndex((d) => d.id === doc.id);
  if (existingIdx >= 0) {
    memoryStore.documents[existingIdx] = doc;
  } else {
    memoryStore.documents.unshift(doc);
  }

  // Replace chunks
  memoryStore.chunks = memoryStore.chunks.filter((c) => c.documentId !== doc.id);
  memoryStore.chunks.push(...chunks);

  await saveLocalStore();
}

/**
 * Reprocesses an existing document from its storage file.
 */
export async function reprocessKnowledgeDocument(
  id: string
): Promise<{ success: boolean; document?: KnowledgeDocument; error?: string }> {
  const docResult = await getKnowledgeDocument(id);
  if (!docResult) return { success: false, error: "Document not found." };

  const { document } = docResult;
  const buffer = await downloadFromStorage(document.storagePath);
  if (!buffer) {
    return { success: false, error: "Could not download original file from storage." };
  }

  const extraction = await extractDocumentContent(buffer, document.name, document.mimeType);

  if (!extraction.success) {
    document.status = "failed";
    document.errorMessage = extraction.error || "Extraction failed.";
    document.updatedAt = new Date().toISOString();
    await persistDocument(document, []);
    return { success: false, document, error: document.errorMessage };
  }

  const now = new Date().toISOString();
  const chunks: KnowledgeChunk[] = extraction.chunks.map((draft) => ({
    id: crypto.randomUUID(),
    documentId: document.id,
    chunkIndex: draft.chunkIndex,
    content: draft.content,
    pageNumber: draft.pageNumber,
    sectionTitle: draft.sectionTitle,
    sourceMetadata: draft.sourceMetadata,
    createdAt: now,
  }));

  document.status = "ready";
  document.pageCount = extraction.pageCount;
  document.chunkCount = chunks.length;
  document.errorMessage = null;
  document.processedAt = now;
  document.updatedAt = now;

  await persistDocument(document, chunks);

  return { success: true, document };
}

/**
 * Archives or restores a document.
 */
export async function setDocumentStatus(
  id: string,
  status: KnowledgeDocumentStatus
): Promise<boolean> {
  const docResult = await getKnowledgeDocument(id);
  if (!docResult) return false;

  const { document, chunks } = docResult;
  document.status = status;
  document.updatedAt = new Date().toISOString();
  await persistDocument(document, chunks);
  return true;
}

/**
 * Deletes a document and its storage object permanently.
 */
export async function deleteKnowledgeDocument(id: string): Promise<boolean> {
  const docResult = await getKnowledgeDocument(id);
  if (!docResult) return false;

  await deleteFromStorage(docResult.document.storagePath);

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from("knowledge_chunks").delete().eq("document_id", id);
      await supabase.from("knowledge_documents").delete().eq("id", id);
    } catch {
      // Fallback
    }
  }

  await loadLocalStore();
  memoryStore.documents = memoryStore.documents.filter((d) => d.id !== id);
  memoryStore.chunks = memoryStore.chunks.filter((c) => c.documentId !== id);
  await saveLocalStore();

  return true;
}
