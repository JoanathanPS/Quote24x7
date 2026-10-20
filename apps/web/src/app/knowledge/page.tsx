"use client";

import * as React from "react";
import {
  BookOpen,
  FilePdf,
  FileDoc,
  FileXls,
  FileText,
  FileCode,
  MagnifyingGlass,
  UploadSimple,
  Eye,
  DownloadSimple,
  ArrowClockwise,
  Archive,
  Trash,
  CheckCircle,
  WarningCircle,
  FolderOpen,
  Stack,
  HardDrives,
} from "@phosphor-icons/react";
import { useKnowledgeDocuments } from "@/hooks/use-api";
import { formatDateTime } from "@/lib/utils";
import type { KnowledgeDocument, KnowledgeDocumentStatus } from "@/types/domain";

import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DocumentViewer } from "@/components/knowledge/document-viewer";
import { DocumentUploader } from "@/components/knowledge/document-uploader";

const CATEGORY_TABS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All Categories" },
  { value: "pricing", label: "Pricing" },
  { value: "plans", label: "Plans" },
  { value: "add_ons", label: "Add-ons" },
  { value: "entitlements", label: "Entitlements" },
  { value: "product_docs", label: "Product Docs" },
  { value: "policies", label: "Policies" },
  { value: "other", label: "Other" },
];

export default function KnowledgePage() {
  const [selectedCategory, setSelectedCategory] = React.useState<string>("all");
  const [selectedStatus, setSelectedStatus] = React.useState<string>("all");
  const [searchQuery, setSearchQuery] = React.useState<string>("");

  // Modal states
  const [isUploaderOpen, setIsUploaderOpen] = React.useState(false);
  const [previewDocument, setPreviewDocument] = React.useState<KnowledgeDocument | null>(null);

  const { data, isLoading, refetch } = useKnowledgeDocuments({
    category: selectedCategory !== "all" ? selectedCategory : undefined,
    status: selectedStatus !== "all" ? selectedStatus : undefined,
    search: searchQuery.trim() || undefined,
  });

  const documents = data?.documents || [];

  // Metrics
  const totalDocs = documents.length;
  const readyDocs = documents.filter((d) => d.status === "ready").length;
  const totalChunks = documents.reduce((sum, d) => sum + (d.chunkCount || 0), 0);
  const totalBytes = documents.reduce((sum, d) => sum + (d.fileSizeBytes || 0), 0);

  const getDocIcon = (filename: string, mimeType: string) => {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    if (ext === "pdf" || mimeType === "application/pdf") {
      return <FilePdf className="h-5 w-5 text-danger" weight="fill" />;
    }
    if (ext === "docx" || mimeType.includes("wordprocessingml")) {
      return <FileDoc className="h-5 w-5 text-primary" weight="fill" />;
    }
    if (ext === "xlsx" || ext === "xls" || ext === "csv" || mimeType.includes("spreadsheet")) {
      return <FileXls className="h-5 w-5 text-success" weight="fill" />;
    }
    if (ext === "md" || ext === "markdown") {
      return <FileCode className="h-5 w-5 text-warning" weight="fill" />;
    }
    return <FileText className="h-5 w-5 text-muted-foreground" weight="fill" />;
  };

  const getStatusBadge = (status: KnowledgeDocumentStatus) => {
    switch (status) {
      case "ready":
        return (
          <Badge variant="success" className="gap-1 text-[11px]">
            <CheckCircle className="h-3 w-3" />
            Ready
          </Badge>
        );
      case "processing":
        return (
          <Badge variant="warning" className="gap-1 text-[11px]">
            <ArrowClockwise className="h-3 w-3 animate-spin" />
            Indexing
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="danger" className="gap-1 text-[11px]">
            <WarningCircle className="h-3 w-3" />
            Failed
          </Badge>
        );
      case "archived":
        return (
          <Badge variant="neutral" className="gap-1 text-[11px]">
            <Archive className="h-3 w-3" />
            Archived
          </Badge>
        );
      default:
        return <Badge variant="default">{status}</Badge>;
    }
  };

  const handleReprocess = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/knowledge/${id}/reprocess`, { method: "POST" });
      if (res.ok) {
        refetch();
      }
    } catch (err) {
      console.error("Failed to reprocess:", err);
    }
  };

  const handleToggleArchive = async (doc: KnowledgeDocument) => {
    const nextStatus = doc.status === "archived" ? "ready" : "archived";
    try {
      const res = await fetch(`/api/v1/knowledge/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        refetch();
      }
    } catch (err) {
      console.error("Failed to archive/restore:", err);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to permanently delete "${name}" and all its extracted chunks?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/v1/knowledge/${id}`, { method: "DELETE" });
      if (res.ok) {
        refetch();
      }
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Knowledge Library
            </h1>
            <Badge variant="neutral" className="font-mono text-xs">
              Supabase Storage
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Securely store and preview Site24x7 documentation, pricing sheets, and entitlement guides used to trace and verify automated proposals.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="gap-1.5 text-xs h-9"
          >
            <ArrowClockwise className="h-3.5 w-3.5" />
            Refresh
          </Button>

          <Button
            size="sm"
            variant="default"
            onClick={() => setIsUploaderOpen(true)}
            className="gap-1.5 text-xs h-9"
          >
            <UploadSimple className="h-4 w-4" />
            Upload Document
          </Button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/80 bg-surface shadow-xs p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Total Documents</span>
            <FolderOpen className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold font-mono text-foreground mt-2">
            {totalDocs}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Stored across all categories</p>
        </Card>

        <Card className="border-border/80 bg-surface shadow-xs p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Indexed &amp; Ready</span>
            <CheckCircle className="h-4 w-4 text-success" />
          </div>
          <div className="text-2xl font-bold font-mono text-foreground mt-2">
            {readyDocs}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Available for proposal search</p>
        </Card>

        <Card className="border-border/80 bg-surface shadow-xs p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Search Chunks</span>
            <Stack className="h-4 w-4 text-info" />
          </div>
          <div className="text-2xl font-bold font-mono text-foreground mt-2">
            {totalChunks}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">GIN vector indexed sections</p>
        </Card>

        <Card className="border-border/80 bg-surface shadow-xs p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Storage Volume</span>
            <HardDrives className="h-4 w-4 text-warning" />
          </div>
          <div className="text-2xl font-bold font-mono text-foreground mt-2">
            {(totalBytes / 1024 / 1024).toFixed(2)} MB
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">In quote24x7-knowledge</p>
        </Card>
      </div>

      {/* Category Tabs & Filter Toolbar */}
      <div className="space-y-3">
        <Tabs
          value={selectedCategory}
          onValueChange={setSelectedCategory}
          className="w-full"
        >
          <div className="overflow-x-auto pb-1">
            <TabsList className="bg-surface border border-border h-9 p-1 gap-1">
              {CATEGORY_TABS.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="text-xs px-3 h-7 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-medium"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>

        {/* Search & Status Filters */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-surface p-3 rounded-lg border border-border/80 shadow-xs">
          <div className="relative w-full sm:w-80">
            <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search documents by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 text-xs pl-9 pr-3"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <span className="text-xs text-muted-foreground shrink-0">Status:</span>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
                <SelectItem value="ready" className="text-xs">Ready</SelectItem>
                <SelectItem value="processing" className="text-xs">Processing</SelectItem>
                <SelectItem value="failed" className="text-xs">Failed</SelectItem>
                <SelectItem value="archived" className="text-xs">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Documents Data Table */}
      <Card className="border-border/80 bg-surface shadow-xs">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : documents.length === 0 ? (
            <div className="py-12">
              <EmptyState
                icon={BookOpen}
                title="No knowledge documents found"
                description={
                  searchQuery || selectedCategory !== "all" || selectedStatus !== "all"
                    ? "No documents match the active filter criteria. Try clearing filters."
                    : "Upload your first PDF, DOCX, CSV, or spreadsheet to establish verified provenance for proposal pricing."
                }
                action={
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => setIsUploaderOpen(true)}
                    className="gap-1.5"
                  >
                    <UploadSimple className="h-4 w-4" />
                    Upload Document
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="w-[300px]">Document</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Size &amp; Pages</TableHead>
                    <TableHead>Chunks</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((doc) => (
                    <TableRow
                      key={doc.id}
                      className="border-border/60 hover:bg-surface-raised/50 transition-colors"
                    >
                      {/* Document Name & Icon */}
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded bg-surface-sunken border border-border/60 shrink-0">
                            {getDocIcon(doc.name, doc.mimeType)}
                          </div>
                          <div className="min-w-0">
                            <button
                              onClick={() => setPreviewDocument(doc)}
                              className="text-xs font-semibold text-foreground hover:text-primary transition-colors truncate block text-left max-w-[240px]"
                              title={doc.name}
                            >
                              {doc.name}
                            </button>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              SHA: {doc.sha256.substring(0, 8)}...
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      {/* Category */}
                      <TableCell>
                        <Badge variant="neutral" className="capitalize text-[11px] font-normal">
                          {doc.category.replace("_", " ")}
                        </Badge>
                      </TableCell>

                      {/* Version */}
                      <TableCell className="font-mono text-xs">
                        v{doc.version}
                      </TableCell>

                      {/* Size & Pages */}
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        <span>{(doc.fileSizeBytes / 1024).toFixed(1)} KB</span>
                        {doc.pageCount && (
                          <span className="ml-1 text-[11px]">({doc.pageCount} pgs)</span>
                        )}
                      </TableCell>

                      {/* Chunks */}
                      <TableCell className="font-mono text-xs">
                        {doc.chunkCount > 0 ? (
                          <span className="text-foreground">{doc.chunkCount}</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>

                      {/* Status */}
                      <TableCell>
                        {getStatusBadge(doc.status)}
                      </TableCell>

                      {/* Uploaded Date */}
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(doc.createdAt)}
                      </TableCell>

                      {/* Action Menu */}
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPreviewDocument(doc)}
                            className="h-7 px-2 text-xs gap-1"
                            title="Preview document inline"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>Preview</span>
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            title="Download original file"
                          >
                            <a
                              href={`/api/v1/knowledge/${doc.id}/raw?download=true`}
                              download={doc.name}
                            >
                              <DownloadSimple className="h-3.5 w-3.5" />
                            </a>
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleReprocess(doc.id)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            title="Reprocess and re-extract text"
                          >
                            <ArrowClockwise className="h-3.5 w-3.5" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleArchive(doc)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            title={doc.status === "archived" ? "Unarchive" : "Archive"}
                          >
                            <Archive className="h-3.5 w-3.5" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(doc.id, doc.name)}
                            className="h-7 w-7 p-0 text-danger/80 hover:text-danger hover:bg-danger-soft/20"
                            title="Delete permanently"
                          >
                            <Trash className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Built-in Document Viewer Dialog */}
      <DocumentViewer
        document={previewDocument}
        isOpen={!!previewDocument}
        onClose={() => setPreviewDocument(null)}
        onReprocess={handleReprocess}
      />

      {/* Document Uploader Dialog */}
      <DocumentUploader
        isOpen={isUploaderOpen}
        onClose={() => setIsUploaderOpen(false)}
        onSuccess={(_doc) => {
          refetch();
        }}
      />
    </div>
  );
}
