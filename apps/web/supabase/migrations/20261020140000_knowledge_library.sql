-- Knowledge Library Migration for Quote24x7
-- Creates knowledge_documents, knowledge_chunks, full-text search indexes, and private storage bucket

-- 1. Create storage bucket for knowledge documents if not exists
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'quote24x7-knowledge',
  'quote24x7-knowledge',
  false,
  52428800, -- 50MB limit
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
    'text/markdown'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 52428800;

-- 2. Create knowledge_documents table
CREATE TABLE IF NOT EXISTS public.knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_extension TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other' CHECK (
    category IN ('pricing', 'plans', 'add_ons', 'entitlements', 'product_docs', 'policies', 'other')
  ),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (
    status IN ('uploaded', 'processing', 'ready', 'failed', 'archived')
  ),
  page_count INTEGER,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_sha256 ON public.knowledge_documents (sha256);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_category ON public.knowledge_documents (category);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_status ON public.knowledge_documents (status);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_created_at ON public.knowledge_documents (created_at DESC);

-- 3. Create knowledge_chunks table
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  page_number INTEGER,
  section_title TEXT,
  source_metadata JSONB DEFAULT '{}'::jsonb,
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(section_title, '') || ' ' || content)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc_id ON public.knowledge_chunks (document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_search_vector ON public.knowledge_chunks USING GIN (search_vector);

-- 4. Enable RLS and restrict to service role
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'knowledge_documents' AND policyname = 'Service role full access on knowledge_documents'
  ) THEN
    CREATE POLICY "Service role full access on knowledge_documents"
      ON public.knowledge_documents
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'knowledge_chunks' AND policyname = 'Service role full access on knowledge_chunks'
  ) THEN
    CREATE POLICY "Service role full access on knowledge_chunks"
      ON public.knowledge_chunks
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
