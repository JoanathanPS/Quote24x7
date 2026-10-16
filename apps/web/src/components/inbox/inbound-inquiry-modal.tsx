"use client";

import * as React from "react";
import {
  FileText,
  FilePdf,
  Table,
  UploadSimple,
  CheckCircle,
  WarningCircle,
  ArrowsClockwise,
  Paperclip,
  Sparkle,
  EnvelopeSimple,
  Buildings,
  User,
  X,
} from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface InboundInquiryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (threadId: string, quoteId?: string) => void;
}

type Mode = "text" | "word" | "pdf" | "excel";

export function InboundInquiryModal({
  open,
  onOpenChange,
  onSuccess,
}: InboundInquiryModalProps) {
  const [mode, setMode] = React.useState<Mode>("word");
  const [senderName, setSenderName] = React.useState("Elena Rostova");
  const [senderEmail, setSenderEmail] = React.useState("elena.rostova@cloudscale-solutions.example.com");
  const [organisation, setOrganisation] = React.useState("CloudScale Global Solutions Ltd");
  const [subject, setSubject] = React.useState("Infrastructure Sizing & Quote Inquiry");
  const [bodyText, setBodyText] = React.useState(
    "Hello Site24x7 team,\n\nPlease find our technical monitoring specification enclosed in the attached document. Kindly provide an official commercial quotation."
  );

  // File state
  const [uploadedFile, setUploadedFile] = React.useState<File | null>(null);
  const [filePreview, setFilePreview] = React.useState<{
    name: string;
    sizeKb: number;
    kind: "word" | "pdf" | "excel";
    summary?: string;
  } | null>(null);

  // Processing state
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [successInfo, setSuccessInfo] = React.useState<{
    threadId: string;
    quoteId?: string;
    actionTaken: string;
  } | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Reset state when modal opens
  React.useEffect(() => {
    if (open) {
      setErrorMsg(null);
      setSuccessInfo(null);
    }
  }, [open]);

  // Handle local file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);
    const lower = file.name.toLowerCase();
    const kind: "word" | "pdf" | "excel" = lower.endsWith(".pdf")
      ? "pdf"
      : lower.endsWith(".docx") || lower.endsWith(".doc")
      ? "word"
      : "excel";

    setFilePreview({
      name: file.name,
      sizeKb: Math.round(file.size / 1024),
      kind,
      summary: `Uploaded ${kind.toUpperCase()} file ready for automated multi-format ingestion.`,
    });
  };

  // Load sample Word specification
  const loadSampleWord = () => {
    setMode("word");
    setSenderName("Marcus Vance");
    setSenderEmail("marcus.vance@apex-enterprises.example.com");
    setOrganisation("Apex Enterprise Systems");
    setSubject("Production Infrastructure Monitoring RFP [Word Doc]");
    setBodyText(
      "Hi Quote24x7 operations team,\n\nWe are evaluating Site24x7 across our primary and secondary datacenter clusters. The complete bill of materials and workload capacity metrics are provided in the attached Word specification document.\n\nRegards,\nMarcus Vance"
    );

    // Create a mock file object in memory with real text for the parser
    const sampleContent =
      "PROJECT APEX INFRASTRUCTURE SPECIFICATION\n" +
      "Workload Requirements for 2026-2027 Production Operations:\n" +
      "- 50 Production Linux and Windows virtual hosts\n" +
      "- 12 Distribution Network Switches and Routers\n" +
      "- 4 Synthetic Transaction Monitors for API health\n" +
      "- 2 Website uptime checks\n" +
      "- Annual commercial billing commitment requested.";

    const blob = new Blob([sampleContent], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const file = new File([blob], "Apex_Production_Infrastructure_Spec.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    setUploadedFile(file);
    setFilePreview({
      name: "Apex_Production_Infrastructure_Spec.docx",
      sizeKb: Math.round(blob.size / 1024) || 2,
      kind: "word",
      summary: "50 Linux/Windows servers, 12 network switches, 4 synthetic monitors, 2 websites.",
    });
  };

  // Load sample PDF specification
  const loadSamplePdf = () => {
    setMode("pdf");
    setSenderName("Dr. Anita Roy");
    setSenderEmail("anita.roy@biotech-research.example.com");
    setOrganisation("BioTech Research Labs");
    setSubject("Site24x7 Monitoring Architecture Proposal [PDF Attached]");
    setBodyText(
      "Dear Solutions Engineer,\n\nPlease review our attached technical architecture PDF document for our server farm and synthetic endpoint requirements.\n\nBest regards,\nDr. Anita Roy"
    );

    const sampleContent =
      "BIOTECH ARCHITECTURE SPECIFICATION:\n" +
      "Servers: 30 Linux servers deployed in Bangalore and Mumbai datacenters\n" +
      "Websites: 5 website and web application uptime checks\n" +
      "Network Devices: 8 core switches\n" +
      "Log Management: 20 GB monthly AppLogs volume\n" +
      "Commercial Terms: Annual billing preferred in INR.";

    const blob = new Blob([sampleContent], { type: "application/pdf" });
    const file = new File([blob], "BioTech_Monitoring_Architecture.pdf", {
      type: "application/pdf",
    });

    setUploadedFile(file);
    setFilePreview({
      name: "BioTech_Monitoring_Architecture.pdf",
      sizeKb: Math.round(blob.size / 1024) || 3,
      kind: "pdf",
      summary: "30 Linux servers, 5 website checks, 8 network switches, 20 GB logs.",
    });
  };

  // Load sample Excel inventory
  const loadSampleExcel = () => {
    setMode("excel");
    setSenderName("Rahul Sharma");
    setSenderEmail("rahul.sharma@fintech-cloud.example.com");
    setOrganisation("FinTech Cloud Payments Private Limited");
    setSubject("Infrastructure Fleet Inventory & Sizing [Excel]");
    setBodyText(
      "Hi,\n\nAttached is our latest quarterly server fleet inventory spreadsheet with active host and switch counts. Please provide a formal Site24x7 proposal.\n\nThanks,\nRahul"
    );

    const csvContent =
      "Metric Type,Quantity,Environment,SLA\n" +
      "Linux Servers,80,Production AWS & Azure,99.99%\n" +
      "Network Switches,15,Main Datacenter,24x7\n" +
      "Synthetic Checks,6,Payment Gateways,1-min\n" +
      "Real User Monitoring (Pageviews),2000000,Portal Web,Monthly\n" +
      "AppLogs Log Management (GB),50,Compliance,30-day";

    const blob = new Blob([csvContent], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const file = new File([blob], "FinTech_Fleet_Inventory_Q4.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    setUploadedFile(file);
    setFilePreview({
      name: "FinTech_Fleet_Inventory_Q4.xlsx",
      sizeKb: Math.round(blob.size / 1024) || 4,
      kind: "excel",
      summary: "80 Linux servers, 15 network switches, 6 synthetic checks, 2M RUM views, 50 GB logs.",
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const formData = new FormData();
      formData.append("from", senderEmail.trim());
      if (senderName.trim()) formData.append("fromName", senderName.trim());
      formData.append("subject", subject.trim());
      formData.append("text", bodyText.trim());

      if (uploadedFile) {
        formData.append("file", uploadedFile);
      }

      const res = await fetch("/api/v1/inbound", {
        method: "POST",
        headers: {
          "x-quote24x7-simulated": "true",
        },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to process inbound message");
      }

      setSuccessInfo({
        threadId: data.threadId,
        quoteId: data.quote?.id,
        actionTaken: data.actionTaken,
      });

      if (onSuccess) {
        onSuccess(data.threadId, data.quote?.id);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Inbound ingestion failed";
      setErrorMsg(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-surface p-0 overflow-hidden border-border shadow-xl">
        {/* Header */}
        <DialogHeader className="p-5 pb-3 border-b border-border bg-surface-sunken/40">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <EnvelopeSimple className="h-4 w-4" weight="bold" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-foreground">
                Receive Inbound Inquiry (Multi-Format)
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Ingest customer sizing requests via Plain Text, Word (.docx), PDF (.pdf), or Excel (.xlsx/.csv).
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Success State View */}
        {successInfo ? (
          <div className="p-6 text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success">
              <CheckCircle size={32} weight="fill" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-foreground">
                Inbound Inquiry Processed Successfully!
              </h3>
              <p className="text-xs text-muted-foreground">
                Action taken:{" "}
                <Badge variant={successInfo.actionTaken === "quoted" ? "success" : "warning"} className="font-mono text-xs">
                  {successInfo.actionTaken.toUpperCase()}
                </Badge>
              </p>
            </div>

            <div className="rounded-lg border border-border bg-surface-sunken p-4 text-xs font-mono space-y-1.5 text-left max-w-md mx-auto">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Thread ID:</span>
                <span className="font-semibold text-foreground">#{successInfo.threadId}</span>
              </div>
              {successInfo.quoteId && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Generated Quote:</span>
                  <span className="font-semibold text-primary">Quote #{successInfo.quoteId}</span>
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSuccessInfo(null);
                  setUploadedFile(null);
                  setFilePreview(null);
                }}
              >
                Receive Another
              </Button>
              <Button
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Close & View Inbox
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* Format Selector Tabs */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                Inquiry Format & Attached Documents
              </label>
              <Tabs value={mode} onValueChange={(val) => setMode(val as Mode)}>
                <TabsList className="grid grid-cols-4 w-full h-9 p-1">
                  <TabsTrigger value="text" className="text-xs gap-1.5 data-[state=active]:font-semibold">
                    <FileText className="h-3.5 w-3.5" />
                    <span>Text</span>
                  </TabsTrigger>
                  <TabsTrigger value="word" className="text-xs gap-1.5 data-[state=active]:font-semibold">
                    <FileText className="h-3.5 w-3.5 text-blue-500" />
                    <span>Word (.docx)</span>
                  </TabsTrigger>
                  <TabsTrigger value="pdf" className="text-xs gap-1.5 data-[state=active]:font-semibold">
                    <FilePdf className="h-3.5 w-3.5 text-rose-500" />
                    <span>PDF (.pdf)</span>
                  </TabsTrigger>
                  <TabsTrigger value="excel" className="text-xs gap-1.5 data-[state=active]:font-semibold">
                    <Table className="h-3.5 w-3.5 text-emerald-500" />
                    <span>Excel (.xlsx)</span>
                  </TabsTrigger>
                </TabsList>

                {/* Text Mode */}
                <TabsContent value="text" className="pt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      Enter inquiry text directly:
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setBodyText(
                          "We need an urgent quote for 45 Linux servers, 10 Cisco network switches, 3 synthetic web checks, and 2M monthly RUM pageviews. Billed annually."
                        );
                      }}
                      className="text-[11px] text-primary hover:underline font-medium inline-flex items-center gap-1"
                    >
                      <Sparkle className="h-3 w-3" />
                      Insert Sample Text
                    </button>
                  </div>
                </TabsContent>

                {/* Word Mode */}
                <TabsContent value="word" className="pt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      Upload Word specification (.docx or .doc):
                    </span>
                    <button
                      type="button"
                      onClick={loadSampleWord}
                      className="text-[11px] text-primary hover:underline font-medium inline-flex items-center gap-1"
                    >
                      <Sparkle className="h-3 w-3" />
                      Load Sample Word RFP (.docx)
                    </button>
                  </div>
                </TabsContent>

                {/* PDF Mode */}
                <TabsContent value="pdf" className="pt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      Upload PDF specification document (.pdf):
                    </span>
                    <button
                      type="button"
                      onClick={loadSamplePdf}
                      className="text-[11px] text-primary hover:underline font-medium inline-flex items-center gap-1"
                    >
                      <Sparkle className="h-3 w-3" />
                      Load Sample PDF Spec (.pdf)
                    </button>
                  </div>
                </TabsContent>

                {/* Excel Mode */}
                <TabsContent value="excel" className="pt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      Upload Excel spreadsheet inventory (.xlsx, .xls, .csv):
                    </span>
                    <button
                      type="button"
                      onClick={loadSampleExcel}
                      className="text-[11px] text-primary hover:underline font-medium inline-flex items-center gap-1"
                    >
                      <Sparkle className="h-3 w-3" />
                      Load Sample Excel Fleet (.xlsx)
                    </button>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            {/* Document Upload Drop Area (Visible for Word, PDF, Excel) */}
            {mode !== "text" && (
              <div className="space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={
                    mode === "word"
                      ? ".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                      : mode === "pdf"
                      ? ".pdf,application/pdf"
                      : ".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                  }
                  onChange={handleFileChange}
                  className="hidden"
                />

                {filePreview ? (
                  <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary-soft/10 p-3">
                    <div className="flex items-center gap-2.5">
                      {filePreview.kind === "word" && <FileText className="h-6 w-6 text-blue-500" />}
                      {filePreview.kind === "pdf" && <FilePdf className="h-6 w-6 text-rose-500" />}
                      {filePreview.kind === "excel" && <Table className="h-6 w-6 text-emerald-500" />}
                      <div>
                        <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          {filePreview.name}
                          <Badge variant="neutral" className="text-[10px] py-0">
                            {filePreview.sizeKb} KB
                          </Badge>
                        </div>
                        {filePreview.summary && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {filePreview.summary}
                          </div>
                        )}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setUploadedFile(null);
                        setFilePreview(null);
                      }}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-4 text-center cursor-pointer hover:bg-muted/40 transition-colors"
                  >
                    <UploadSimple className="h-6 w-6 text-muted-foreground mb-1" />
                    <span className="text-xs font-medium text-foreground">
                      Click to upload {mode === "word" ? "Word (.docx)" : mode === "pdf" ? "PDF (.pdf)" : "Excel (.xlsx/.csv)"}
                    </span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">
                      Or drag and drop your document here
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Sender and Subject Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" />
                  Sender Name
                </label>
                <input
                  type="text"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="e.g. Sarah Jenkins"
                  className="flex h-8 w-full rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                  <EnvelopeSimple className="h-3 w-3" />
                  Sender Email
                </label>
                <input
                  type="email"
                  required
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                  placeholder="e.g. buyer@company.com"
                  className="flex h-8 w-full rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                  <Buildings className="h-3 w-3" />
                  Organisation
                </label>
                <input
                  type="text"
                  value={organisation}
                  onChange={(e) => setOrganisation(e.target.value)}
                  placeholder="e.g. Acme Corporation"
                  className="flex h-8 w-full rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">
                  Email Subject
                </label>
                <input
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Infrastructure Sizing Request"
                  className="flex h-8 w-full rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                />
              </div>
            </div>

            {/* Email Body Text */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">
                Email Body Text
              </label>
              <textarea
                rows={3}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                placeholder="Write message body or instructions..."
                className="flex w-full rounded-md border border-border bg-surface p-2.5 text-xs text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              />
            </div>

            {errorMsg && (
              <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger-soft/20 p-2.5 text-xs text-danger">
                <WarningCircle className="h-4 w-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Footer Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting}
                className="gap-1.5 shadow-sm"
              >
                {isSubmitting ? (
                  <>
                    <ArrowsClockwise className="h-3.5 w-3.5 animate-spin" />
                    <span>Processing Ingestion...</span>
                  </>
                ) : (
                  <>
                    <Paperclip className="h-3.5 w-3.5" />
                    <span>Process Inbound Inquiry</span>
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
