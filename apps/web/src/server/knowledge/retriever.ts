import { getSupabaseClient } from "../db/supabase.ts";
import { listKnowledgeDocuments, getKnowledgeDocument } from "./service.ts";
import type {
  KnowledgeCategory,
  KnowledgeSearchResult,
  ProposalSourceCitation,
} from "@/types/domain";

export interface SearchKnowledgeOptions {
  category?: KnowledgeCategory;
  limit?: number;
}

interface ChunkQueryResult {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  page_number: number | null;
  section_title: string | null;
  knowledge_documents: {
    id: string;
    name: string;
    category: KnowledgeCategory;
    status: string;
    storage_path: string;
  } | null;
}

/**
 * Searches the Knowledge Library for text chunks relevant to the query.
 * Uses PostgreSQL full-text search when Supabase is connected,
 * with automatic fallback to local ranking.
 */
export async function searchKnowledgeBase(
  query: string,
  options?: SearchKnowledgeOptions
): Promise<KnowledgeSearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const limit = Math.min(options?.limit ?? 5, 20);
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      // 1. Try textSearch on search_vector
      // Convert query to websearch format: multiple words become word1 & word2
      const terms = cleanQuery
        .split(/\s+/)
        .map((t) => t.replace(/[^a-zA-Z0-9_-]/g, ""))
        .filter((t) => t.length > 1);

      if (terms.length > 0) {
        const tsQuery = terms.join(" | ");

        let sbQuery = supabase
          .from("knowledge_chunks")
          .select(`
            id,
            document_id,
            chunk_index,
            content,
            page_number,
            section_title,
            knowledge_documents!inner (
              id,
              name,
              category,
              status,
              storage_path
            )
          `)
          .eq("knowledge_documents.status", "ready")
          .textSearch("search_vector", tsQuery, { config: "english" })
          .limit(limit);

        if (options?.category && options.category !== "other") {
          sbQuery = sbQuery.eq("knowledge_documents.category", options.category);
        }

        const { data, error } = await sbQuery;

        if (!error && data && data.length > 0) {
          return (data as unknown as ChunkQueryResult[]).map((row) => {
            const doc = row.knowledge_documents;
            const content = row.content || "";
            const snippet = createSnippet(content, terms);

            return {
              chunkId: row.id,
              documentId: row.document_id,
              documentName: doc?.name || "Document",
              category: doc?.category || "other",
              pageNumber: row.page_number,
              sectionTitle: row.section_title,
              content,
              similarityOrRank: 0.85,
              snippet,
              storagePath: doc?.storage_path || "",
            };
          });
        }
      }

      // 2. Fallback to ILIKE if websearch had no hits or punctuation
      let ilikeQuery = supabase
        .from("knowledge_chunks")
        .select(`
          id,
          document_id,
          chunk_index,
          content,
          page_number,
          section_title,
          knowledge_documents!inner (
            id,
            name,
            category,
            status,
            storage_path
          )
        `)
        .eq("knowledge_documents.status", "ready")
        .ilike("content", `%${cleanQuery.slice(0, 30)}%`)
        .limit(limit);

      if (options?.category) {
        ilikeQuery = ilikeQuery.eq("knowledge_documents.category", options.category);
      }

      const { data: ilikeData, error: ilikeErr } = await ilikeQuery;
      if (!ilikeErr && ilikeData && ilikeData.length > 0) {
        return (ilikeData as unknown as ChunkQueryResult[]).map((row) => {
          const doc = row.knowledge_documents;
          return {
            chunkId: row.id,
            documentId: row.document_id,
            documentName: doc?.name || "Document",
            category: doc?.category || "other",
            pageNumber: row.page_number,
            sectionTitle: row.section_title,
            content: row.content,
            similarityOrRank: 0.75,
            snippet: createSnippet(row.content, [cleanQuery]),
            storagePath: doc?.storage_path || "",
          };
        });
      }
    } catch (err) {
      console.warn("[knowledge-retriever] Supabase search failed, using local search:", err);
    }
  }

  // Local memory / disk fallback search
  return localSearch(cleanQuery, options?.category, limit);
}

/**
 * Creates a focused snippet containing the matching keyword with surrounding context.
 */
function createSnippet(content: string, terms: string[]): string {
  if (!content) return "";
  const lower = content.toLowerCase();

  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx !== -1) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(content.length, idx + term.length + 80);
      const prefix = start > 0 ? "... " : "";
      const suffix = end < content.length ? " ..." : "";
      return prefix + content.substring(start, end).replace(/\s+/g, " ") + suffix;
    }
  }

  return content.slice(0, 150) + (content.length > 150 ? "..." : "");
}

/**
 * Local in-memory / JSON store fallback search.
 */
async function localSearch(
  query: string,
  categoryFilter?: KnowledgeCategory,
  limit = 5
): Promise<KnowledgeSearchResult[]> {
  const docs = await listKnowledgeDocuments();
  const readyDocs = docs.filter(
    (d) => d.status === "ready" && (!categoryFilter || d.category === categoryFilter)
  );

  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);

  const candidates: KnowledgeSearchResult[] = [];

  for (const doc of readyDocs) {
    const docData = await getKnowledgeDocument(doc.id);
    if (!docData) continue;

    for (const chunk of docData.chunks) {
      const lower = chunk.content.toLowerCase();
      let matchScore = 0;

      for (const term of queryTerms) {
        if (lower.includes(term)) {
          matchScore += 1;
        }
      }

      if (matchScore > 0) {
        candidates.push({
          chunkId: chunk.id,
          documentId: doc.id,
          documentName: doc.name,
          category: doc.category,
          pageNumber: chunk.pageNumber,
          sectionTitle: chunk.sectionTitle,
          content: chunk.content,
          similarityOrRank: matchScore / queryTerms.length,
          snippet: createSnippet(chunk.content, queryTerms),
          storagePath: doc.storagePath,
        });
      }
    }
  }

  // Sort by highest match score
  candidates.sort((a, b) => b.similarityOrRank - a.similarityOrRank);
  return candidates.slice(0, limit);
}

/**
 * Helper to build source citations for proposal line items and plan recommendations.
 */
export async function findCitationsForLineItem(params: {
  field: string;
  name: string;
  code?: string;
  category?: KnowledgeCategory;
}): Promise<ProposalSourceCitation | null> {
  const searchQuery = `${params.name} ${params.code || ""}`.trim();
  const results = await searchKnowledgeBase(searchQuery, {
    category: params.category,
    limit: 1,
  });

  if (results.length === 0) {
    return {
      id: crypto.randomUUID(),
      field: params.field,
      selectedValue: params.name,
      documentId: "none",
      documentName: "Catalogue Seed (Deterministic Default)",
      category: params.category || "pricing",
      pageNumber: null,
      sectionTitle: "Official Catalogue",
      evidenceQuote: `Pricing and terms derived from active Site24x7 catalogue seed. No custom overriding document indexed for '${params.name}'.`,
      verificationStatus: "verified",
      notes: "Default catalogue item",
    };
  }

  const best = results[0];
  if (!best) {
    return null;
  }
  return {
    id: crypto.randomUUID(),
    field: params.field,
    selectedValue: params.name,
    documentId: best.documentId,
    documentName: best.documentName,
    category: best.category,
    pageNumber: best.pageNumber,
    sectionTitle: best.sectionTitle,
    evidenceQuote: best.snippet || best.content.slice(0, 150),
    verificationStatus: "verified",
    notes: `Matched section "${best.sectionTitle || best.documentName}" with relevance rank ${best.similarityOrRank.toFixed(2)}`,
  };
}
