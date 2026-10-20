"use client";

import * as React from "react";
import {
  X,
  DownloadSimple,
  ArrowsOut,
  ArrowsIn,
  ArrowSquareOut,
  MagnifyingGlass,
  FilePdf,
  FileDoc,
  FileXls,
  FileText,
  FileCode,
  Article,
  Copy,
  Check,
  ArrowClockwise,
  ListNumbers,
  Table as TableIcon,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { formatDateTime, cn } from "@/lib/utils";
import type { KnowledgeDocument, KnowledgeChunk } from "@/types/domain";

interface DocumentViewerProps {
  document: KnowledgeDocument | null;
  isOpen: boolean;
  onClose: () => void;
  onReprocess?: (id: string) => Promise<void>;
}

interface PreviewData {
  type: "pdf" | "docx" | "spreadsheet" | "text" | "markdown" | "unsupported" | "error";
  name: string;
  rawUrl?: string;
  pageCount?: number | null;
  html?: string;
  sheets?: Array<{
    name: string;
    headers: string[];
    rows: string[][];
  }>;
  content?: string;
  error?: string;
  chunks?: KnowledgeChunk[];
}

export function DocumentViewer({
  document,
  isOpen,
  onClose,
  onReprocess,
}: DocumentViewerProps) {
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<"preview" | "chunks">("preview");
  const [loading, setLoading] = React.useState(true);
  const [previewData, setPreviewData] = React.useState<PreviewData | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // PDF controls
  const [pdfZoom, setPdfZoom] = React.useState<number>(100);

  // Spreadsheet controls
  const [activeSheetIdx, setActiveSheetIdx] = React.useState(0);
  const [tableSearch, setTableSearch] = React.useState("");
  const [tablePage, setTablePage] = React.useState(1);
  const ROWS_PER_PAGE = 30;

  // Chunks search
  const [chunkSearch, setChunkSearch] = React.useState("");
  const [copiedChunkId, setCopiedChunkId] = React.useState<string | null>(null);
  const [isReprocessing, setIsReprocessing] = React.useState(false);

  React.useEffect(() => {
    if (!document || !isOpen) {
      setPreviewData(null);
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);
    setTableSearch("");
    setTablePage(1);
    setChunkSearch("");
    setActiveSheetIdx(0);

    fetch(`/api/v1/knowledge/${document.id}/preview`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}: Failed to load document preview.`);
        }
        return res.json();
      })
      .then((data: PreviewData) => {
        if (isMounted) {
          setPreviewData(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [document, isOpen]);

  const handleCopyChunk = (chunk: KnowledgeChunk) => {
    navigator.clipboard.writeText(chunk.content);
    setCopiedChunkId(chunk.id);
    setTimeout(() => setCopiedChunkId(null), 2000);
  };

  const handleReprocess = async () => {
    if (!document || !onReprocess || isReprocessing) return;
    setIsReprocessing(true);
    try {
      await onReprocess(document.id);
      // Reload preview
      const res = await fetch(`/api/v1/knowledge/${document.id}/preview`);
      if (res.ok) {
        const data = await res.json();
        setPreviewData(data);
      }
    } finally {
      setIsReprocessing(false);
    }
  };

  const getDocIcon = () => {
    const ext = document?.fileExtension.toLowerCase() || "";
    if (ext === "pdf") return <FilePdf className="h-5 w-5 text-danger" weight="fill" />;
    if (ext === "docx") return <FileDoc className="h-5 w-5 text-primary" weight="fill" />;
    if (ext === "xlsx" || ext === "xls" || ext === "csv")
      return <FileXls className="h-5 w-5 text-success" weight="fill" />;
    if (ext === "md" || ext === "markdown")
      return <FileCode className="h-5 w-5 text-warning" weight="fill" />;
    return <FileText className="h-5 w-5 text-muted-foreground" weight="fill" />;
  };

  // Filter spreadsheet rows
  const currentSheet = previewData?.sheets?.[activeSheetIdx];
  const filteredRows = React.useMemo(() => {
    if (!currentSheet?.rows) return [];
    if (!tableSearch.trim()) return currentSheet.rows;
    const q = tableSearch.toLowerCase();
    return currentSheet.rows.filter((row) =>
      row.some((cell) => cell.toLowerCase().includes(q))
    );
  }, [currentSheet, tableSearch]);

  const totalTablePages = Math.ceil(filteredRows.length / ROWS_PER_PAGE) || 1;
  const paginatedRows = filteredRows.slice(
    (tablePage - 1) * ROWS_PER_PAGE,
    tablePage * ROWS_PER_PAGE
  );

  // Filter chunks
  const filteredChunks = React.useMemo(() => {
    const chunks = previewData?.chunks || [];
    if (!chunkSearch.trim()) return chunks;
    const q = chunkSearch.toLowerCase();
    return chunks.filter(
      (c) =>
        c.content.toLowerCase().includes(q) ||
        (c.sectionTitle && c.sectionTitle.toLowerCase().includes(q))
    );
  }, [previewData?.chunks, chunkSearch]);

  if (!document) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          "flex flex-col p-0 gap-0 bg-surface border-border overflow-hidden transition-all duration-200",
          isFullscreen
            ? "fixed inset-0 w-screen h-screen max-w-none rounded-none z-50"
            : "w-[95vw] max-w-5xl h-[88vh] rounded-lg shadow-2xl"
        )}
      >
        {/* Header Bar */}
        <DialogHeader className="p-4 px-5 border-b border-border bg-surface-raised flex flex-row items-center justify-between shrink-0 space-y-0">
          <div className="flex items-center gap-3 min-w-0 pr-4">
            <div className="p-2 rounded-md bg-surface-sunken border border-border/60 shrink-0">
              {getDocIcon()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-base font-semibold truncate text-foreground">
                  {document.name}
                </DialogTitle>
                <Badge variant="neutral" className="text-[10px] uppercase font-mono px-1.5 py-0">
                  v{document.version}
                </Badge>
                <Badge variant="primary" className="text-[10px] capitalize px-1.5 py-0">
                  {document.category.replace("_", " ")}
                </Badge>
              </div>
              <DialogDescription className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                <span>{(document.fileSizeBytes / 1024).toFixed(1)} KB</span>
                <span>•</span>
                <span>Uploaded {formatDateTime(document.createdAt)}</span>
                {document.pageCount && (
                  <>
                    <span>•</span>
                    <span>{document.pageCount} pages</span>
                  </>
                )}
                <span>•</span>
                <span className="font-mono text-[10px] text-muted-foreground/80">
                  SHA: {document.sha256.substring(0, 8)}...
                </span>
              </DialogDescription>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-1.5 shrink-0">
            {onReprocess && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleReprocess}
                disabled={isReprocessing}
                className="h-8 gap-1.5 text-xs"
                title="Reprocess and re-extract document text"
              >
                <ArrowClockwise className={cn("h-3.5 w-3.5", isReprocessing && "animate-spin")} />
                <span>Reprocess</span>
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              asChild
              className="h-8 gap-1.5 text-xs"
            >
              <a
                href={`/api/v1/knowledge/${document.id}/raw?download=true`}
                download={document.name}
              >
                <DownloadSimple className="h-3.5 w-3.5" />
                <span>Download</span>
              </a>
            </Button>

            <Button
              variant="outline"
              size="sm"
              asChild
              className="h-8 gap-1.5 text-xs"
              title="Open raw file in a new tab"
            >
              <a
                href={`/api/v1/knowledge/${document.id}/raw`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ArrowSquareOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Raw</span>
              </a>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <ArrowsIn className="h-4 w-4" /> : <ArrowsOut className="h-4 w-4" />}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* View Mode Tabs */}
        <div className="flex items-center justify-between px-5 border-b border-border bg-surface-sunken/40 shrink-0">
          <Tabs
            value={activeTab}
            onValueChange={(val) => setActiveTab(val as "preview" | "chunks")}
            className="w-auto"
          >
            <TabsList className="bg-transparent h-10 p-0 gap-4">
              <TabsTrigger
                value="preview"
                className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-2 h-10 text-xs font-medium"
              >
                <Article className="h-4 w-4 mr-1.5" />
                Document Preview
              </TabsTrigger>
              <TabsTrigger
                value="chunks"
                className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-2 h-10 text-xs font-medium"
              >
                <ListNumbers className="h-4 w-4 mr-1.5" />
                Extracted Chunks ({document.chunkCount || previewData?.chunks?.length || 0})
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {document.status === "ready" ? (
              <Badge variant="success" className="gap-1 text-[11px]">
                <ShieldCheck className="h-3 w-3" />
                Indexed &amp; Ready
              </Badge>
            ) : document.status === "processing" ? (
              <Badge variant="warning" className="gap-1 text-[11px]">
                <ArrowClockwise className="h-3 w-3 animate-spin" />
                Extracting
              </Badge>
            ) : (
              <Badge variant="danger" className="gap-1 text-[11px]">
                <WarningCircle className="h-3 w-3" />
                {document.status}
              </Badge>
            )}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-hidden relative bg-surface-sunken/20">
          {loading ? (
            <div className="p-8 space-y-4">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <WarningCircle className="h-10 w-10 text-danger mb-3" />
              <h3 className="text-sm font-semibold text-foreground">Could not preview document</h3>
              <p className="text-xs text-muted-foreground max-w-md mt-1 mb-4">{error}</p>
              <Button size="sm" asChild>
                <a href={`/api/v1/knowledge/${document.id}/raw?download=true`}>
                  <DownloadSimple className="h-3.5 w-3.5 mr-1.5" />
                  Download File Directly
                </a>
              </Button>
            </div>
          ) : activeTab === "preview" ? (
            /* PREVIEW TAB */
            <div className="h-full flex flex-col overflow-hidden">
              {/* PDF Previewer */}
              {previewData?.type === "pdf" && (
                <div className="h-full flex flex-col">
                  {/* PDF Toolbar */}
                  <div className="flex items-center justify-between px-4 py-2 bg-surface-raised border-b border-border text-xs shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Zoom:</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPdfZoom(Math.max(50, pdfZoom - 25))}
                        className="h-6 px-2 text-xs"
                      >
                        -
                      </Button>
                      <span className="font-mono w-10 text-center">{pdfZoom}%</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPdfZoom(Math.min(200, pdfZoom + 25))}
                        className="h-6 px-2 text-xs"
                      >
                        +
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPdfZoom(100)}
                        className="h-6 px-2 text-xs text-muted-foreground"
                      >
                        Reset
                      </Button>
                    </div>

                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span>Native Interactive PDF Viewer</span>
                    </div>
                  </div>

                  <div className="flex-1 overflow-auto bg-muted/40 p-4 flex justify-center">
                    <div
                      className="transition-all duration-150 h-full w-full max-w-4xl shadow-md rounded bg-surface border border-border"
                      style={{
                        transform: `scale(${pdfZoom / 100})`,
                        transformOrigin: "top center",
                      }}
                    >
                      <iframe
                        src={`${previewData.rawUrl}#toolbar=1&navpanes=1`}
                        className="w-full h-full border-0 rounded"
                        title={previewData.name}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* DOCX Previewer */}
              {previewData?.type === "docx" && (
                <div className="h-full overflow-y-auto p-8 max-w-4xl mx-auto w-full bg-surface shadow-xs border-x border-border/60">
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none text-foreground leading-relaxed [&_table]:border-collapse [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:bg-surface-sunken [&_th]:p-2 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm"
                    dangerouslySetInnerHTML={{ __html: previewData.html || "" }}
                  />
                </div>
              )}

              {/* Spreadsheet Previewer */}
              {previewData?.type === "spreadsheet" && (
                <div className="h-full flex flex-col overflow-hidden">
                  {/* Sheet switcher & search toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-surface-raised border-b border-border shrink-0">
                    {/* Sheet Tabs */}
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                      {(previewData.sheets || []).map((sheet, idx) => (
                        <button
                          key={sheet.name}
                          onClick={() => {
                            setActiveSheetIdx(idx);
                            setTablePage(1);
                          }}
                          className={cn(
                            "px-3 py-1 text-xs font-medium rounded-md border transition-colors shrink-0",
                            activeSheetIdx === idx
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-surface text-muted-foreground border-border hover:bg-surface-sunken"
                          )}
                        >
                          <TableIcon className="inline-block h-3.5 w-3.5 mr-1" />
                          {sheet.name} ({sheet.rows.length})
                        </button>
                      ))}
                    </div>

                    {/* Search inside sheet */}
                    <div className="flex items-center gap-2">
                      <div className="relative w-48 sm:w-64">
                        <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          placeholder="Filter sheet rows..."
                          value={tableSearch}
                          onChange={(e) => {
                            setTableSearch(e.target.value);
                            setTablePage(1);
                          }}
                          className="h-7 text-xs pl-8 pr-2"
                        />
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 font-mono">
                        {filteredRows.length} rows
                      </span>
                    </div>
                  </div>

                  {/* Table Grid */}
                  <div className="flex-1 overflow-auto bg-surface">
                    {currentSheet && currentSheet.rows.length > 0 ? (
                      <table className="w-full text-xs text-left border-collapse">
                        <thead className="bg-surface-sunken sticky top-0 border-b border-border text-muted-foreground z-10">
                          <tr>
                            <th className="p-2.5 w-12 text-center font-mono border-r border-border/80">#</th>
                            {currentSheet.headers.map((h, i) => (
                              <th key={i} className="p-2.5 font-semibold text-foreground border-r border-border/60 whitespace-nowrap">
                                {h || `Col ${i + 1}`}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50 font-mono">
                          {paginatedRows.map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-surface-raised/60 transition-colors">
                              <td className="p-2 w-12 text-center text-muted-foreground/70 border-r border-border/80 bg-surface-sunken/20">
                                {(tablePage - 1) * ROWS_PER_PAGE + rIdx + 1}
                              </td>
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} className="p-2 border-r border-border/40 whitespace-nowrap max-w-xs truncate text-foreground">
                                  {cell || "-"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-8 text-center text-xs text-muted-foreground">
                        No rows found in this sheet.
                      </div>
                    )}
                  </div>

                  {/* Pagination footer */}
                  {totalTablePages > 1 && (
                    <div className="flex items-center justify-between p-2.5 px-4 bg-surface-raised border-t border-border shrink-0 text-xs text-muted-foreground">
                      <span>
                        Page {tablePage} of {totalTablePages}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setTablePage(Math.max(1, tablePage - 1))}
                          disabled={tablePage === 1}
                          className="h-6 px-2 text-xs"
                        >
                          Prev
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setTablePage(Math.min(totalTablePages, tablePage + 1))}
                          disabled={tablePage >= totalTablePages}
                          className="h-6 px-2 text-xs"
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Text / Markdown Previewer */}
              {(previewData?.type === "text" || previewData?.type === "markdown") && (
                <div className="h-full overflow-y-auto p-6 max-w-4xl mx-auto w-full">
                  <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed text-foreground bg-surface p-5 rounded-lg border border-border shadow-xs">
                    {previewData.content}
                  </pre>
                </div>
              )}

              {/* Unsupported format */}
              {previewData?.type === "unsupported" && (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                  <FileText className="h-12 w-12 text-muted-foreground mb-3" />
                  <h3 className="text-sm font-semibold text-foreground">
                    Inline Preview Not Supported for this File Type
                  </h3>
                  <p className="text-xs text-muted-foreground max-w-md mt-1 mb-4">
                    {previewData.error || "This format cannot be previewed directly inside the dashboard."}
                  </p>
                  <Button size="sm" asChild>
                    <a href={previewData.rawUrl}>
                      <DownloadSimple className="h-3.5 w-3.5 mr-1.5" />
                      Download Original File
                    </a>
                  </Button>
                </div>
              )}
            </div>
          ) : (
            /* EXTRACTED CHUNKS TAB */
            <div className="h-full flex flex-col">
              {/* Chunks filter bar */}
              <div className="p-3 bg-surface-raised border-b border-border flex items-center justify-between gap-3 shrink-0">
                <div className="relative w-72">
                  <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search extracted text chunks..."
                    value={chunkSearch}
                    onChange={(e) => setChunkSearch(e.target.value)}
                    className="h-7 text-xs pl-8 pr-2"
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  Showing {filteredChunks.length} of {previewData?.chunks?.length || 0} chunks
                </div>
              </div>

              {/* Chunks list */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {filteredChunks.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted-foreground">
                    {chunkSearch ? "No chunks matched your search term." : "No extracted chunks available."}
                  </div>
                ) : (
                  filteredChunks.map((chunk) => (
                    <div
                      key={chunk.id}
                      className="rounded-lg border border-border bg-surface p-4 shadow-xs text-xs space-y-2 hover:border-border/80 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="neutral" className="font-mono text-[10px] px-1.5">
                            Chunk #{chunk.chunkIndex + 1}
                          </Badge>
                          {chunk.pageNumber && (
                            <Badge variant="neutral" className="text-[10px] px-1.5">
                              Page {chunk.pageNumber}
                            </Badge>
                          )}
                          {chunk.sectionTitle && (
                            <span className="font-semibold text-foreground truncate max-w-sm">
                              {chunk.sectionTitle}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {chunk.content.length} chars (~{Math.round(chunk.content.length / 4)} tokens)
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyChunk(chunk)}
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                            title="Copy chunk text"
                          >
                            {copiedChunkId === chunk.id ? (
                              <Check className="h-3.5 w-3.5 text-success" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>

                      <p className="font-mono text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed bg-surface-sunken/40 p-3 rounded border border-border/40">
                        {chunk.content}
                      </p>

                      {chunk.sourceMetadata && Object.keys(chunk.sourceMetadata).length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1 border-t border-border/40 text-[10px] text-muted-foreground">
                          {Object.entries(chunk.sourceMetadata).map(([k, v]) => (
                            <span key={k} className="bg-surface-raised px-1.5 py-0.5 rounded border border-border/60">
                              <span className="font-medium text-foreground">{k}:</span> {String(v)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
