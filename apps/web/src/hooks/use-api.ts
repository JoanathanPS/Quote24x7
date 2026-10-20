"use client";

import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api-client";
import type {
  CatalogueVersion,
  DeliveryRecord,
  EmailMessage,
  EmailThread,
  OverviewMetrics,
  Quote,
  RequirementProfile,
  SystemHealth,
  IntegrationStatus,
  AiDecisionRecord,
  KnowledgeDocument,
} from "@/types/domain";

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export function useThreads(params?: Record<string, string | undefined>) {
  return useQuery({
    queryKey: ["threads", params],
    queryFn: () => apiGet<EmailThread[]>("/api/v1/threads", params),
    refetchInterval: 4000,
  });
}

export function useThread(id: string) {
  return useQuery({
    queryKey: ["threads", id],
    queryFn: () => apiGet<EmailThread>(`/api/v1/threads/${id}`),
    enabled: !!id,
    refetchInterval: 4000,
  });
}

export function useThreadMessages(threadId: string) {
  return useQuery({
    queryKey: ["threads", threadId, "messages"],
    queryFn: () => apiGet<EmailMessage[]>(`/api/v1/threads/${threadId}/messages`),
    enabled: !!threadId,
    refetchInterval: 4000,
  });
}

export function useThreadRequirements(threadId: string) {
  return useQuery({
    queryKey: ["threads", threadId, "requirements"],
    queryFn: () => apiGet<RequirementProfile>(`/api/v1/threads/${threadId}/requirements`),
    enabled: !!threadId,
    refetchInterval: 4000,
  });
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export function useQuotes() {
  return useQuery({
    queryKey: ["quotes"],
    queryFn: () => apiGet<Quote[]>("/api/v1/quotes"),
  });
}

export function useQuote(id: string) {
  return useQuery({
    queryKey: ["quotes", id],
    queryFn: () => apiGet<Quote>(`/api/v1/quotes/${id}`),
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------

export function useDeliveries(params?: Record<string, string | undefined>) {
  return useQuery({
    queryKey: ["deliveries", params],
    queryFn: () => apiGet<DeliveryRecord[]>("/api/v1/deliveries", params),
  });
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export function useCatalogues() {
  return useQuery({
    queryKey: ["catalogues"],
    queryFn: () => apiGet<CatalogueVersion[]>("/api/v1/catalogues"),
  });
}

// ---------------------------------------------------------------------------
// Overview metrics
// ---------------------------------------------------------------------------

export function useOverviewMetrics() {
  return useQuery({
    queryKey: ["metrics", "summary"],
    queryFn: () => apiGet<OverviewMetrics>("/api/v1/metrics/summary"),
  });
}

// ---------------------------------------------------------------------------
// System health
// ---------------------------------------------------------------------------

export function useSystemHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => apiGet<SystemHealth>("/api/v1/health"),
    refetchInterval: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export function useIntegrations() {
  return useQuery({
    queryKey: ["integrations"],
    queryFn: () => apiGet<IntegrationStatus[]>("/api/v1/integrations"),
  });
}

// ---------------------------------------------------------------------------
// AI Decisions
// ---------------------------------------------------------------------------

export function useThreadAiDecisions(threadId: string) {
  return useQuery({
    queryKey: ["threads", threadId, "decisions"],
    queryFn: () => apiGet<AiDecisionRecord[]>(`/api/v1/threads/${threadId}/decisions`),
    enabled: !!threadId,
  });
}

// ---------------------------------------------------------------------------
// Knowledge Library
// ---------------------------------------------------------------------------

export function useKnowledgeDocuments(params?: {
  category?: string;
  status?: string;
  search?: string;
}) {
  return useQuery({
    queryKey: ["knowledge", params],
    queryFn: () => apiGet<{ documents: KnowledgeDocument[] }>("/api/v1/knowledge", params),
    refetchInterval: 5000,
  });
}
