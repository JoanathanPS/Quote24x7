"use client";

import * as React from "react";
import {
  UploadSimple,
  FileText,
  FilePdf,
  FileDoc,
  FileXls,
  FileCode,
  CheckCircle,
  WarningCircle,
  ArrowClockwise,
  X,
  FileArrowUp,
  ShieldCheck,
} from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { KnowledgeCategory, KnowledgeDocument } from "@/types/domain";

interface DocumentUploaderProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (doc: KnowledgeDocument) => void;
}

const CATEGORIES: Array<{ value: KnowledgeCategory; label: string; desc: string }> = [
  { value: "pricing", label: "Pricing", desc: "Price lists, discount tiers, currency rates" },
  { value: "plans", label: "Plans", desc: "Plan editions, base allowances, tiers" },
  { value: "add_ons", label: "Add-ons", desc: "Add-on pack sizes, units, and top-up rules" },
  { value: "entitlements", label: "Entitlements", desc: "Feature matrix and monitor quotas" },
  { value: "product_docs", label: "Product Documentation", desc: "Technical guides and specifications" },
  { value: "policies", label: "Policies", desc: "Terms, validity, SLA, compliance policies" },
  { value: "other", label: "Other", desc: "Miscellaneous reference materials" },
];

export function DocumentUploader({ isOpen, onClose, onSuccess }: DocumentUploaderProps) {
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [category, setCategory] = React.useState<KnowledgeCategory>("pricing");
  const [version, setVersion] = React.useState<number>(1);
  const [isDragging, setIsDragging] = React.useState(false);

  // Upload lifecycle state
  const [status, setStatus] = React.useState<
    "idle" | "uploading" | "indexing" | "success" | "duplicate" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [duplicateDoc, setDuplicateDoc] = React.useState<KnowledgeDocument | null>(null);
  const [progressPercent, setProgressPercent] = React.useState(0);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setSelectedFile(null);
    setCategory("pricing");
    setVersion(1);
    setStatus("idle");
    setErrorMessage(null);
    setDuplicateDoc(null);
    setProgressPercent(0);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
  };

  const handleFileSelected = (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    const allowed = ["pdf", "docx", "xlsx", "xls", "csv", "txt", "md", "markdown"];

    if (!ext || !allowed.includes(ext)) {
      setErrorMessage(
        `File '.${ext}' is unsupported. Please upload PDF, DOCX, XLSX, XLS, CSV, TXT, or MD.`
      );
      setStatus("error");
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setErrorMessage("File exceeds the 50MB maximum size limit.");
      setStatus("error");
      return;
    }

    setSelectedFile(file);
    setStatus("idle");
    setErrorMessage(null);
    setDuplicateDoc(null);
  };

  const handleSubmit = async (allowDuplicate = false) => {
    if (!selectedFile) return;

    setStatus("uploading");
    setProgressPercent(30);
    setErrorMessage(null);

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("category", category);
    formData.append("version", version.toString());
    if (allowDuplicate) {
      formData.append("allowDuplicate", "true");
    }

    try {
      // Simulate indexing transition
      setTimeout(() => {
        if (status === "uploading") {
          setStatus("indexing");
          setProgressPercent(70);
        }
      }, 600);

      const res = await fetch("/api/v1/knowledge", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.status === 409 && data.isDuplicate) {
        setStatus("duplicate");
        setDuplicateDoc(data.existingDocument);
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}: Upload failed.`);
      }

      setProgressPercent(100);
      setStatus("success");
      onSuccess(data.document);

      setTimeout(() => {
        resetForm();
        onClose();
      }, 1200);
    } catch (err: unknown) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const getDocIcon = (filename: string) => {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "pdf") return <FilePdf className="h-6 w-6 text-danger" weight="fill" />;
    if (ext === "docx") return <FileDoc className="h-6 w-6 text-primary" weight="fill" />;
    if (ext === "xlsx" || ext === "xls" || ext === "csv")
      return <FileXls className="h-6 w-6 text-success" weight="fill" />;
    if (ext === "md") return <FileCode className="h-6 w-6 text-warning" weight="fill" />;
    return <FileText className="h-6 w-6 text-muted-foreground" weight="fill" />;
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          resetForm();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg bg-surface border-border p-6 shadow-2xl">
        <DialogHeader className="pb-3 border-b border-border">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <FileArrowUp className="h-5 w-5 text-primary" />
            Upload Knowledge Document
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Original files are stored securely in Supabase Storage with extracted text indexed for proposal accuracy.
          </DialogDescription>
        </DialogHeader>

        {status === "duplicate" && duplicateDoc ? (
          /* DUPLICATE WARNING MODAL */
          <div className="py-4 space-y-4">
            <div className="rounded-lg border border-warning/40 bg-warning-soft/20 p-4 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-semibold text-warning-soft-foreground">
                <WarningCircle className="h-4 w-4 text-warning" />
                <span>Identical Document Already Exists</span>
              </div>
              <p className="text-foreground/90">
                A document with the exact same SHA-256 content hash is already registered in the Knowledge Library:
              </p>
              <div className="p-3 bg-surface rounded border border-border/60 font-mono text-[11px] space-y-1">
                <div><strong>Name:</strong> {duplicateDoc.name}</div>
                <div><strong>Category:</strong> {duplicateDoc.category}</div>
                <div><strong>Version:</strong> v{duplicateDoc.version}</div>
                <div><strong>Status:</strong> {duplicateDoc.status}</div>
                <div><strong>SHA-256:</strong> {duplicateDoc.sha256}</div>
              </div>
              <p className="text-muted-foreground">
                Do you want to proceed and save this as an additional reference or update the version?
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetForm}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => handleSubmit(true)}
              >
                Upload Anyway
              </Button>
            </div>
          </div>
        ) : status === "uploading" || status === "indexing" ? (
          /* PROGRESS BAR VIEW */
          <div className="py-8 space-y-4 text-center">
            <ArrowClockwise className="h-8 w-8 text-primary animate-spin mx-auto" />
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-foreground">
                {status === "uploading" ? "Uploading to Supabase Storage..." : "Extracting Text & Building Search Chunks..."}
              </h4>
              <p className="text-xs text-muted-foreground">
                {status === "uploading"
                  ? "Storing original binary in private bucket quote24x7-knowledge"
                  : "Parsing document structure and persisting full-text search vectors"}
              </p>
            </div>

            {/* Progress Track */}
            <div className="w-full bg-surface-sunken h-2 rounded-full overflow-hidden border border-border">
              <div
                className="bg-primary h-full transition-all duration-300 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        ) : status === "success" ? (
          /* SUCCESS VIEW */
          <div className="py-8 text-center space-y-2">
            <CheckCircle className="h-10 w-10 text-success mx-auto" />
            <h4 className="text-sm font-semibold text-foreground">Document Successfully Indexed!</h4>
            <p className="text-xs text-muted-foreground">
              Extracted content is now available for proposal verification and retrieval.
            </p>
          </div>
        ) : (
          /* FILE SELECTION & METADATA FORM */
          <div className="space-y-4 py-2">
            {/* Dropzone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-2",
                isDragging
                  ? "border-primary bg-primary-soft/10"
                  : "border-border/80 hover:border-primary/60 bg-surface-sunken/30"
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleFileSelected(file);
                  }
                }}
              />

              {selectedFile ? (
                <div className="flex items-center gap-3 p-2 bg-surface rounded-md border border-border shadow-xs w-full max-w-sm">
                  {getDocIcon(selectedFile.name)}
                  <div className="text-left min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate text-foreground">
                      {selectedFile.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="p-3 rounded-full bg-surface-raised border border-border shadow-xs">
                    <UploadSimple className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-foreground">
                      Drag &amp; drop document, or <span className="text-primary underline">browse</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      PDF, DOCX, XLSX, XLS, CSV, TXT, MD up to 50MB
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Error Banner */}
            {errorMessage && (
              <div className="rounded-md border border-danger/40 bg-danger-soft/20 p-2.5 text-xs text-danger-soft-foreground flex items-center gap-2">
                <WarningCircle className="h-4 w-4 text-danger shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Category & Version */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="space-y-1.5">
                <label htmlFor="category" className="text-xs font-semibold block text-foreground">
                  Document Category
                </label>
                <Select
                  value={category}
                  onValueChange={(val) => setCategory(val as KnowledgeCategory)}
                >
                  <SelectTrigger id="category" className="h-8 text-xs">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value} className="text-xs">
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="version" className="text-xs font-semibold block text-foreground">
                  Version Number
                </label>
                <Input
                  id="version"
                  type="number"
                  min={1}
                  value={version}
                  onChange={(e) => setVersion(parseInt(e.target.value, 10) || 1)}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-border">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-success" />
                <span>Private &amp; RLS Protected</span>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => handleSubmit(false)}
                  disabled={!selectedFile}
                >
                  Upload &amp; Extract
                </Button>
              </div>
            </div>

          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
