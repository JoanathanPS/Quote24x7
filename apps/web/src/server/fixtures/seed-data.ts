import type {
  DeliveryRecord,
  EmailMessage,
  EmailThread,
  IntegrationStatus,
  OverviewMetrics,
  Quote,
  QuoteDocument,
  RequirementProfile,
  SystemHealth,
} from "@/types/domain";

import { loadActiveCatalogue } from "../catalogue/loader.ts";
import { emptyDemand, type PricingDemand } from "../pricing/engine.ts";
import { buildQuote } from "../pricing/quote-builder.ts";

/**
 * Seed data for Quote24x7 operational console.
 *
 * Contains 5 realistic email threads at distinct processing stages:
 * - thread_01: completed with quote (Priya Sharma, CloudNexus Solutions)
 * - thread_02: awaiting clarification reply (Marcus Chen, Velocity Commerce)
 * - thread_03: pricing / calculating quote (Aisha Patel, FinServe India)
 * - thread_04: failed delivery / bounced (David Kim, StreamScale Media)
 * - thread_05: received, pending processing (Lisa Nguyen, GreenField Logistics)
 *
 * Quotes are strictly computed by the real pricing engine using active catalogue data.
 * All amounts are integers in minor units (paise).
 */

interface SeedDataResult {
  threads: EmailThread[];
  messages: EmailMessage[];
  profiles: Map<string, RequirementProfile>;
  quotes: Map<string, Quote>;
  deliveries: DeliveryRecord[];
  metrics: OverviewMetrics;
  health: SystemHealth;
  integrations: IntegrationStatus[];
}

let cachedSeedData: SeedDataResult | null = null;

function createSeedData(): SeedDataResult {
  const catalogue = loadActiveCatalogue();

  // ---------------------------------------------------------------------------
  // Thread 1: Completed with Quote
  // ---------------------------------------------------------------------------
  const profile01: RequirementProfile = {
    id: "profile_01",
    threadId: "thread_01",
    version: 1,
    supersedesProfileId: null,
    createdAt: "2026-10-10T09:16:00.000Z",
    extractorModel: "claude-3-5-sonnet-20241022",
    extractorRunId: "run_ext_01",
    summary:
      "Customer requires monitoring for 80 Linux servers, 15 network devices, 4 synthetic transaction endpoints, 2M RUM pageviews/mo, and 50GB logs/mo with annual billing in INR.",
    fields: [
      {
        key: "servers",
        label: "Server / Host Monitors",
        group: "infrastructure",
        value: 80,
        unit: "servers",
        state: "provided",
        confidence: 0.99,
        evidence: "We currently operate 80 Linux servers",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "network_devices",
        label: "Network Devices",
        group: "infrastructure",
        value: 15,
        unit: "devices",
        state: "provided",
        confidence: 0.98,
        evidence: "15 network devices (switches/routers)",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "advanced_monitors",
        label: "Advanced Monitors",
        group: "applications",
        value: 4,
        unit: "monitors",
        state: "provided",
        confidence: 0.95,
        evidence:
          "4 business-critical web endpoints that need advanced monitoring with synthetic transaction checks",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "rum_pageviews",
        label: "RUM Pageviews",
        group: "applications",
        value: 2000000,
        unit: "pageviews/month",
        state: "provided",
        confidence: 0.96,
        evidence: "2 million RUM pageviews per month across our portals",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "applogs_volume",
        label: "AppLogs Volume",
        group: "applications",
        value: 50,
        unit: "GB/month",
        state: "provided",
        confidence: 0.97,
        evidence: "about 50 GB/month of AppLogs for log aggregation",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "billing_period",
        label: "Billing Frequency",
        group: "commercial",
        value: "annual",
        unit: null,
        state: "provided",
        confidence: 0.95,
        evidence: "Could you please share an annual pricing quote and breakdown of recommended plans?",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "currency",
        label: "Currency",
        group: "commercial",
        value: "INR",
        unit: null,
        state: "inferred",
        confidence: 0.92,
        evidence: "Indian infrastructure",
        conflictWith: null,
        previousValue: null,
        materialToPricing: false,
      },
      {
        key: "operating_system",
        label: "Operating System",
        group: "context",
        value: "Linux",
        unit: null,
        state: "provided",
        confidence: 0.96,
        evidence: "80 Linux servers",
        conflictWith: null,
        previousValue: null,
        materialToPricing: false,
      },
    ],
    pendingQuestions: [],
    answeredQuestions: [],
    clarificationRound: 0,
  };

  const demand01: PricingDemand = {
    ...emptyDemand(),
    host_monitor: 80,
    network_component: 15,
    advanced_monitor: 4,
    rum_pageview: 2_000_000,
    applog_gb: 50,
  };

  const doc01: QuoteDocument = {
    id: "doc_quote_01",
    quoteId: "quote_01",
    documentType: "quote",
    fileName: "Quote-CloudNexus-2026-10.pdf",
    contentHash: "sha256:d8c52998a44b15093e871e44f80e03e48109bf1f278b",
    pageCount: 3,
    createdAt: "2026-10-10T11:20:00.000Z",
    storageKey: null,
  };

  const { quote: quote01 } = buildQuote({
    quoteId: "quote_01",
    threadId: "thread_01",
    profile: profile01,
    demand: demand01,
    catalogue,
    createdAt: "2026-10-10T11:15:00.000Z",
    documents: [doc01],
    status: "validated",
  });

  const thread01: EmailThread = {
    id: "thread_01",
    provider: "resend",
    providerThreadId: "th_cloudnexus_8921",
    senderEmail: "priya.sharma@cloudnexus.in",
    senderName: "Priya Sharma",
    organisation: "CloudNexus Solutions",
    subject: "Site24x7 Pricing Quote for CloudNexus Infrastructure",
    status: "completed",
    requestType: "quote",
    createdAt: "2026-10-10T09:15:00.000Z",
    updatedAt: "2026-10-10T14:32:00.000Z",
    lastMessageAt: "2026-10-10T14:30:00.000Z",
    messageCount: 3,
    quoteId: quote01.id,
    quoteTotal: quote01.options[0]?.total ?? null,
    currency: quote01.currency,
    statusDetail: null,
  };

  const messages01: EmailMessage[] = [
    {
      id: "msg_01_1",
      threadId: "thread_01",
      providerMessageId: "in_msg_01_1_cloudnexus",
      direction: "inbound",
      fromAddress: "priya.sharma@cloudnexus.in",
      fromName: "Priya Sharma",
      toAddresses: ["quotes@quote24x7.internal"],
      subject: "Site24x7 Pricing Quote for CloudNexus Infrastructure",
      bodyText:
        "Hi team,\n\nWe are looking to migrate our monitoring to Site24x7 for our Indian infrastructure. We currently operate 80 Linux servers and 15 network devices (switches/routers). We also have 4 business-critical web endpoints that need advanced monitoring with synthetic transaction checks. In addition, we expect around 2 million RUM pageviews per month across our portals and about 50 GB/month of AppLogs for log aggregation.\n\nCould you please share an annual pricing quote and breakdown of recommended plans?\n\nBest regards,\nPriya Sharma\nCTO, CloudNexus Solutions",
      occurredAt: "2026-10-10T09:15:00.000Z",
      deliveryId: null,
      securityNotes: [],
      attachments: [],
    },
    {
      id: "msg_01_2",
      threadId: "thread_01",
      providerMessageId: "out_msg_01_2_quote",
      direction: "outbound",
      fromAddress: "quotes@quote24x7.internal",
      fromName: "Quote24x7 Pricing Assistant",
      toAddresses: ["priya.sharma@cloudnexus.in"],
      subject: "Re: Site24x7 Pricing Quote for CloudNexus Infrastructure",
      bodyText:
        "Dear Priya Sharma,\n\nThank you for considering Site24x7. Based on your stated infrastructure requirements (80 server monitors, 15 network components, 4 advanced monitors, 2,000,000 RUM pageviews/month, and 50 GB AppLogs/month), we have generated your customized annual quotation.\n\nPlease find the official quote attached in PDF format.\n\nOption Summary:\n- Recommended: Best Value Plan with optimized add-on packs.\n- All figures are billed annually in INR.\n\nFeel free to reply if you need any adjustments or further clarifications.\n\nWarm regards,\nQuote24x7 Automated Operations Team",
      occurredAt: "2026-10-10T11:20:00.000Z",
      deliveryId: "del_01",
      securityNotes: [],
      attachments: [
        {
          name: "Quote-CloudNexus-2026-10.pdf",
          contentType: "application/pdf",
          sizeBytes: 148520,
          scanned: true,
        },
      ],
    },
    {
      id: "msg_01_3",
      threadId: "thread_01",
      providerMessageId: "in_msg_01_3_ack",
      direction: "inbound",
      fromAddress: "priya.sharma@cloudnexus.in",
      fromName: "Priya Sharma",
      toAddresses: ["quotes@quote24x7.internal"],
      subject: "Re: Site24x7 Pricing Quote for CloudNexus Infrastructure",
      bodyText:
        "Hi team,\n\nThank you for the prompt quote. We reviewed the breakdown and options with our finance team; the coverage and add-on sizing look solid. We will proceed with procurement through our Zoho partner account next week.\n\nThanks,\nPriya",
      occurredAt: "2026-10-10T14:30:00.000Z",
      deliveryId: null,
      securityNotes: [],
      attachments: [],
    },
  ];

  const delivery01: DeliveryRecord = {
    id: "del_01",
    threadId: "thread_01",
    quoteId: "quote_01",
    provider: "resend",
    providerMessageId: "re_del_01_99182",
    recipient: "priya.sharma@cloudnexus.in",
    subject: "Re: Site24x7 Pricing Quote for CloudNexus Infrastructure",
    status: "delivered",
    attemptCount: 1,
    maxAttempts: 3,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextRetryAt: null,
    retryEligible: false,
    createdAt: "2026-10-10T11:20:00.000Z",
    updatedAt: "2026-10-10T11:20:12.000Z",
    events: [
      {
        at: "2026-10-10T11:20:00.000Z",
        status: "accepted",
        detail: "Accepted by Resend API gateway",
      },
      {
        at: "2026-10-10T11:20:12.000Z",
        status: "delivered",
        detail: "Delivered to destination SMTP server (250 2.0.0 OK)",
      },
    ],
  };

  // ---------------------------------------------------------------------------
  // Thread 2: Awaiting Reply
  // ---------------------------------------------------------------------------
  const profile02: RequirementProfile = {
    id: "profile_02",
    threadId: "thread_02",
    version: 1,
    supersedesProfileId: null,
    createdAt: "2026-10-11T16:22:00.000Z",
    extractorModel: "claude-3-5-sonnet-20241022",
    extractorRunId: "run_ext_02",
    summary:
      "Inquiry for e-commerce monitoring. Missing server/host counts, pageview volumes, and log ingestion estimates.",
    fields: [
      {
        key: "servers",
        label: "Server / Host Monitors",
        group: "infrastructure",
        value: null,
        unit: "servers",
        state: "missing",
        confidence: null,
        evidence: null,
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "network_devices",
        label: "Network Devices",
        group: "infrastructure",
        value: null,
        unit: "devices",
        state: "missing",
        confidence: null,
        evidence: null,
        conflictWith: null,
        previousValue: null,
        materialToPricing: false,
      },
      {
        key: "apm_capability",
        label: "APM Monitoring",
        group: "applications",
        value: "required",
        unit: null,
        state: "provided",
        confidence: 0.95,
        evidence: "We need APM for our microservices",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "rum_pageviews",
        label: "RUM Pageviews",
        group: "applications",
        value: null,
        unit: "pageviews/month",
        state: "missing",
        confidence: null,
        evidence: "real user monitoring for high traffic",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "applogs_volume",
        label: "AppLogs Volume",
        group: "applications",
        value: null,
        unit: "GB/month",
        state: "missing",
        confidence: null,
        evidence: "log management",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "billing_period",
        label: "Billing Frequency",
        group: "commercial",
        value: "annual",
        unit: null,
        state: "inferred",
        confidence: 0.7,
        evidence: "Standard annual default",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "currency",
        label: "Currency",
        group: "commercial",
        value: "INR",
        unit: null,
        state: "inferred",
        confidence: 0.8,
        evidence: "INR default market",
        conflictWith: null,
        previousValue: null,
        materialToPricing: false,
      },
      {
        key: "workload_type",
        label: "Workload Type",
        group: "context",
        value: "E-commerce platform",
        unit: null,
        state: "provided",
        confidence: 0.95,
        evidence: "monitoring for our e-commerce platform ahead of our seasonal promotion",
        conflictWith: null,
        previousValue: null,
        materialToPricing: false,
      },
    ],
    pendingQuestions: [
      {
        id: "cq_02_1",
        fieldKeys: ["servers", "rum_pageviews", "applogs_volume"],
        question:
          "How many servers/hosts do you plan to monitor, and what are your estimated monthly web pageviews and log volumes?",
        reason:
          "Required to determine the appropriate base plan tier and any add-on packs needed for coverage.",
        askedAt: "2026-10-11T16:45:00.000Z",
        answeredAt: null,
        answerSummary: null,
      },
    ],
    answeredQuestions: [],
    clarificationRound: 1,
  };

  const thread02: EmailThread = {
    id: "thread_02",
    provider: "resend",
    providerThreadId: "th_velocity_4310",
    senderEmail: "marcus.chen@velocitycommerce.com",
    senderName: "Marcus Chen",
    organisation: "Velocity Commerce",
    subject: "Site24x7 monitoring inquiry for e-commerce stack",
    status: "awaiting_reply",
    requestType: "clarification",
    createdAt: "2026-10-11T16:20:00.000Z",
    updatedAt: "2026-10-11T16:45:00.000Z",
    lastMessageAt: "2026-10-11T16:45:00.000Z",
    messageCount: 2,
    quoteId: null,
    quoteTotal: null,
    currency: "INR",
    statusDetail: null,
  };

  const messages02: EmailMessage[] = [
    {
      id: "msg_02_1",
      threadId: "thread_02",
      providerMessageId: "in_msg_02_1_velocity",
      direction: "inbound",
      fromAddress: "marcus.chen@velocitycommerce.com",
      fromName: "Marcus Chen",
      toAddresses: ["quotes@quote24x7.internal"],
      subject: "Site24x7 monitoring inquiry for e-commerce stack",
      bodyText:
        "Hello,\n\nWe are looking for end-to-end monitoring for our e-commerce platform ahead of our seasonal promotion. We need APM for our microservices, real user monitoring for high traffic, and log management. What would the pricing look like?\n\nMarcus Chen\nVP Engineering, Velocity Commerce",
      occurredAt: "2026-10-11T16:20:00.000Z",
      deliveryId: null,
      securityNotes: [],
      attachments: [],
    },
    {
      id: "msg_02_2",
      threadId: "thread_02",
      providerMessageId: "out_msg_02_2_clarify",
      direction: "outbound",
      fromAddress: "quotes@quote24x7.internal",
      fromName: "Quote24x7 Pricing Assistant",
      toAddresses: ["marcus.chen@velocitycommerce.com"],
      subject: "Re: Site24x7 monitoring inquiry for e-commerce stack - Sizing Details Needed",
      bodyText:
        "Hi Marcus,\n\nThank you for contacting Site24x7. We'd love to prepare a precise quotation for your e-commerce stack.\n\nTo ensure we provide the most cost-effective tier and add-on allocation, could you clarify:\n1. Approximately how many servers or virtual hosts do you plan to monitor?\n2. What is your anticipated monthly web traffic in terms of RUM pageviews?\n3. Roughly what monthly log ingestion volume (GB) do you estimate for AppLogs?\n\nAs soon as you share these details, we will immediately generate a full quote with side-by-side plan comparisons.\n\nBest regards,\nQuote24x7 Automated Operations Team",
      occurredAt: "2026-10-11T16:45:00.000Z",
      deliveryId: "del_02",
      securityNotes: [],
      attachments: [],
    },
  ];

  const delivery02: DeliveryRecord = {
    id: "del_02",
    threadId: "thread_02",
    quoteId: null,
    provider: "resend",
    providerMessageId: "re_del_02_44192",
    recipient: "marcus.chen@velocitycommerce.com",
    subject: "Re: Site24x7 monitoring inquiry for e-commerce stack - Sizing Details Needed",
    status: "delivered",
    attemptCount: 1,
    maxAttempts: 3,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextRetryAt: null,
    retryEligible: false,
    createdAt: "2026-10-11T16:45:00.000Z",
    updatedAt: "2026-10-11T16:45:10.000Z",
    events: [
      {
        at: "2026-10-11T16:45:00.000Z",
        status: "accepted",
        detail: "Accepted by Resend API gateway",
      },
      {
        at: "2026-10-11T16:45:10.000Z",
        status: "delivered",
        detail: "Delivered to recipient mail server",
      },
    ],
  };

  // ---------------------------------------------------------------------------
  // Thread 3: Processing (Pricing Engine Running)
  // ---------------------------------------------------------------------------
  const profile03: RequirementProfile = {
    id: "profile_03",
    threadId: "thread_03",
    version: 1,
    supersedesProfileId: null,
    createdAt: "2026-10-13T11:12:00.000Z",
    extractorModel: "claude-3-5-sonnet-20241022",
    extractorRunId: "run_ext_03",
    summary:
      "Enterprise monitoring for 200 Linux/Windows servers, 50 network devices, and 10 advanced synthetic monitors across hybrid cloud.",
    fields: [
      {
        key: "servers",
        label: "Server / Host Monitors",
        group: "infrastructure",
        value: 200,
        unit: "servers",
        state: "provided",
        confidence: 0.99,
        evidence: "Our current estate consists of 200 Linux/Windows servers",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "network_devices",
        label: "Network Devices",
        group: "infrastructure",
        value: 50,
        unit: "devices",
        state: "provided",
        confidence: 0.98,
        evidence: "50 network devices (switches, firewalls, and routers)",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "advanced_monitors",
        label: "Advanced Monitors",
        group: "applications",
        value: 10,
        unit: "monitors",
        state: "provided",
        confidence: 0.97,
        evidence: "10 advanced synthetic web monitors with 1-minute polling frequency",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "billing_period",
        label: "Billing Frequency",
        group: "commercial",
        value: "annual",
        unit: null,
        state: "provided",
        confidence: 0.95,
        evidence: "Please calculate an annual quote with enterprise support options",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "currency",
        label: "Currency",
        group: "commercial",
        value: "INR",
        unit: null,
        state: "inferred",
        confidence: 0.95,
        evidence: "FinServe India domain (.in)",
        conflictWith: null,
        previousValue: null,
        materialToPricing: false,
      },
      {
        key: "cloud_environment",
        label: "Cloud Environment",
        group: "context",
        value: "Private Cloud and AWS",
        unit: null,
        state: "provided",
        confidence: 0.95,
        evidence: "across private cloud and AWS",
        conflictWith: null,
        previousValue: null,
        materialToPricing: false,
      },
    ],
    pendingQuestions: [],
    answeredQuestions: [],
    clarificationRound: 0,
  };

  const demand03: PricingDemand = {
    ...emptyDemand(),
    host_monitor: 200,
    network_component: 50,
    advanced_monitor: 10,
  };

  const { quote: quote03 } = buildQuote({
    quoteId: "quote_03",
    threadId: "thread_03",
    profile: profile03,
    demand: demand03,
    catalogue,
    createdAt: "2026-10-13T11:14:00.000Z",
    documents: [],
    status: "estimate",
  });

  const thread03: EmailThread = {
    id: "thread_03",
    provider: "resend",
    providerThreadId: "th_finserve_6602",
    senderEmail: "aisha.patel@finserve.in",
    senderName: "Aisha Patel",
    organisation: "FinServe India",
    subject: "Enterprise Site24x7 Quote Request - 200 Servers",
    status: "pricing",
    requestType: "quote",
    createdAt: "2026-10-13T11:10:00.000Z",
    updatedAt: "2026-10-13T11:15:00.000Z",
    lastMessageAt: "2026-10-13T11:10:00.000Z",
    messageCount: 1,
    quoteId: quote03.id,
    quoteTotal: quote03.options[0]?.total ?? null,
    currency: quote03.currency,
    statusDetail: null,
  };

  const messages03: EmailMessage[] = [
    {
      id: "msg_03_1",
      threadId: "thread_03",
      providerMessageId: "in_msg_03_1_finserve",
      direction: "inbound",
      fromAddress: "aisha.patel@finserve.in",
      fromName: "Aisha Patel",
      toAddresses: ["quotes@quote24x7.internal"],
      subject: "Enterprise Site24x7 Quote Request - 200 Servers",
      bodyText:
        "Hi Site24x7 Sales,\n\nWe need enterprise-grade monitoring for our core financial infrastructure across private cloud and AWS. Our current estate consists of 200 Linux/Windows servers, 50 network devices (switches, firewalls, and routers), and 10 advanced synthetic web monitors with 1-minute polling frequency. Please calculate an annual quote with enterprise support options.\n\nAisha Patel\nInfrastructure Lead, FinServe India",
      occurredAt: "2026-10-13T11:10:00.000Z",
      deliveryId: null,
      securityNotes: [],
      attachments: [],
    },
  ];

  // ---------------------------------------------------------------------------
  // Thread 4: Failed Delivery (Bounced)
  // ---------------------------------------------------------------------------
  const profile04: RequirementProfile = {
    id: "profile_04",
    threadId: "thread_04",
    version: 1,
    supersedesProfileId: null,
    createdAt: "2026-10-12T08:02:00.000Z",
    extractorModel: "claude-3-5-sonnet-20241022",
    extractorRunId: "run_ext_04",
    summary:
      "Video streaming cluster monitoring request for 30 hosts, 5 network devices, and 10 basic monitors.",
    fields: [
      {
        key: "servers",
        label: "Server / Host Monitors",
        group: "infrastructure",
        value: 30,
        unit: "hosts",
        state: "provided",
        confidence: 0.98,
        evidence: "30 hosts for stream transcoding and delivery",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "network_devices",
        label: "Network Devices",
        group: "infrastructure",
        value: 5,
        unit: "devices",
        state: "provided",
        confidence: 0.96,
        evidence: "5 network devices connecting our edge nodes",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "basic_monitors",
        label: "Basic Monitors",
        group: "applications",
        value: 10,
        unit: "monitors",
        state: "inferred",
        confidence: 0.85,
        evidence: "basic monitoring for our stream ingest points",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "billing_period",
        label: "Billing Frequency",
        group: "commercial",
        value: "annual",
        unit: null,
        state: "inferred",
        confidence: 0.8,
        evidence: "Looking for annual billing",
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      },
      {
        key: "currency",
        label: "Currency",
        group: "commercial",
        value: "INR",
        unit: null,
        state: "inferred",
        confidence: 0.85,
        evidence: "INR catalogue default",
        conflictWith: null,
        previousValue: null,
        materialToPricing: false,
      },
    ],
    pendingQuestions: [],
    answeredQuestions: [],
    clarificationRound: 0,
  };

  const demand04: PricingDemand = {
    ...emptyDemand(),
    host_monitor: 30,
    network_component: 5,
    basic_monitor: 10,
  };

  const { quote: quote04 } = buildQuote({
    quoteId: "quote_04",
    threadId: "thread_04",
    profile: profile04,
    demand: demand04,
    catalogue,
    createdAt: "2026-10-12T08:04:00.000Z",
    documents: [],
    status: "delivery_failed",
  });

  const thread04: EmailThread = {
    id: "thread_04",
    provider: "resend",
    providerThreadId: "th_streamscale_2910",
    senderEmail: "david.kim@streamscale.io",
    senderName: "David Kim",
    organisation: "StreamScale Media",
    subject: "Site24x7 quote for video streaming cluster",
    status: "failed",
    requestType: "quote",
    createdAt: "2026-10-12T08:00:00.000Z",
    updatedAt: "2026-10-12T08:25:00.000Z",
    lastMessageAt: "2026-10-12T08:25:00.000Z",
    messageCount: 2,
    quoteId: quote04.id,
    quoteTotal: quote04.options[0]?.total ?? null,
    currency: quote04.currency,
    statusDetail: "Email delivery failed: mailbox not found (550 5.1.1)",
  };

  const messages04: EmailMessage[] = [
    {
      id: "msg_04_1",
      threadId: "thread_04",
      providerMessageId: "in_msg_04_1_streamscale",
      direction: "inbound",
      fromAddress: "david.kim@streamscale.io",
      fromName: "David Kim",
      toAddresses: ["quotes@quote24x7.internal"],
      subject: "Site24x7 quote for video streaming cluster",
      bodyText:
        "Hey folks,\n\nNeed a quick quote for monitoring 30 hosts for stream transcoding and delivery, plus 5 network devices connecting our edge nodes, and basic monitoring for our stream ingest points. Looking for annual billing.\n\nThanks,\nDavid Kim\nSRE, StreamScale Media",
      occurredAt: "2026-10-12T08:00:00.000Z",
      deliveryId: null,
      securityNotes: [],
      attachments: [],
    },
    {
      id: "msg_04_2",
      threadId: "thread_04",
      providerMessageId: "out_msg_04_2_bounced",
      direction: "outbound",
      fromAddress: "quotes@quote24x7.internal",
      fromName: "Quote24x7 Pricing Assistant",
      toAddresses: ["david.kim@streamscale.io"],
      subject: "Re: Site24x7 quote for video streaming cluster",
      bodyText:
        "Hi David,\n\nThank you for reaching out. Attached is your annual quote for 30 host monitors, 5 network devices, and basic monitoring coverage.\n\nBest regards,\nQuote24x7 Automated Operations Team",
      occurredAt: "2026-10-12T08:05:00.000Z",
      deliveryId: "del_04",
      securityNotes: [],
      attachments: [],
    },
  ];

  const delivery04: DeliveryRecord = {
    id: "del_04",
    threadId: "thread_04",
    quoteId: "quote_04",
    provider: "resend",
    providerMessageId: "re_del_04_33019",
    recipient: "david.kim@streamscale.io",
    subject: "Re: Site24x7 quote for video streaming cluster",
    status: "bounced",
    attemptCount: 2,
    maxAttempts: 3,
    lastErrorCode: "550 5.1.1",
    lastErrorMessage: "Email delivery failed: mailbox not found (550 5.1.1)",
    nextRetryAt: null,
    retryEligible: false,
    createdAt: "2026-10-12T08:05:00.000Z",
    updatedAt: "2026-10-12T08:25:00.000Z",
    events: [
      {
        at: "2026-10-12T08:05:00.000Z",
        status: "accepted",
        detail: "Accepted by Resend API gateway",
      },
      {
        at: "2026-10-12T08:05:15.000Z",
        status: "failed",
        detail: "SMTP attempt 1 rejected: 550 5.1.1 User unknown",
      },
      {
        at: "2026-10-12T08:15:00.000Z",
        status: "retry_scheduled",
        detail: "Retry attempt 2 scheduled",
      },
      {
        at: "2026-10-12T08:25:00.000Z",
        status: "bounced",
        detail: "Hard bounce permanent failure: 550 5.1.1 Mailbox does not exist",
      },
    ],
  };

  // ---------------------------------------------------------------------------
  // Thread 5: Just Received (Pending Extraction)
  // ---------------------------------------------------------------------------
  const thread05: EmailThread = {
    id: "thread_05",
    provider: "resend",
    providerThreadId: "th_greenfield_9941",
    senderEmail: "lisa.nguyen@greenfield-logistics.com",
    senderName: "Lisa Nguyen",
    organisation: "GreenField Logistics",
    subject: "RFP / Proposal Request: Hybrid Infrastructure Monitoring",
    status: "received",
    requestType: "proposal",
    createdAt: "2026-10-14T08:30:00.000Z",
    updatedAt: "2026-10-14T08:30:00.000Z",
    lastMessageAt: "2026-10-14T08:30:00.000Z",
    messageCount: 1,
    quoteId: null,
    quoteTotal: null,
    currency: null,
    statusDetail: null,
  };

  const messages05: EmailMessage[] = [
    {
      id: "msg_05_1",
      threadId: "thread_05",
      providerMessageId: "in_msg_05_1_greenfield",
      direction: "inbound",
      fromAddress: "lisa.nguyen@greenfield-logistics.com",
      fromName: "Lisa Nguyen",
      toAddresses: ["quotes@quote24x7.internal"],
      subject: "RFP / Proposal Request: Hybrid Infrastructure Monitoring",
      bodyText:
        "To the Site24x7 Enterprise Sales Team,\n\nGreenField Logistics is requesting a comprehensive proposal for monitoring our hybrid operations across 3 regional data centers. Our estate encompasses approximately 400 servers (bare-metal and hypervisors) and 100 managed network devices. We require multi-datacenter visibility, high-availability monitoring, and centralized reporting.\n\nPlease submit a formal proposal outlining architecture, licensing tiers, and implementation guidelines.\n\nLisa Nguyen\nDirector of IT, GreenField Logistics",
      occurredAt: "2026-10-14T08:30:00.000Z",
      deliveryId: null,
      securityNotes: [],
      attachments: [],
    },
  ];

  // ---------------------------------------------------------------------------
  // Aggregate Collections
  // ---------------------------------------------------------------------------
  const threads: EmailThread[] = [thread01, thread02, thread03, thread04, thread05];
  const messages: EmailMessage[] = [
    ...messages01,
    ...messages02,
    ...messages03,
    ...messages04,
    ...messages05,
  ];

  const profiles = new Map<string, RequirementProfile>([
    ["thread_01", profile01],
    ["thread_02", profile02],
    ["thread_03", profile03],
    ["thread_04", profile04],
  ]);

  const quotes = new Map<string, Quote>([
    ["thread_01", quote01],
    ["thread_03", quote03],
    ["thread_04", quote04],
  ]);

  const deliveries: DeliveryRecord[] = [delivery01, delivery02, delivery04];

  // ---------------------------------------------------------------------------
  // Overview Metrics
  // ---------------------------------------------------------------------------
  const metrics: OverviewMetrics = {
    windowLabel: "Past 7 days (Oct 8 – Oct 14, 2026)",
    emailsReceived: 5,
    quotesGenerated: 3,
    pendingClarifications: 1,
    deliveryFailures: 1,
    threadsByStatus: {
      received: 1,
      extracting: 0,
      awaiting_reply: 1,
      pricing: 1,
      document_generation: 0,
      sending: 0,
      completed: 1,
      failed: 1,
      unsupported: 0,
    },
    activity: [
      { date: "2026-10-08", received: 0, quoted: 0, clarified: 0 },
      { date: "2026-10-09", received: 0, quoted: 0, clarified: 0 },
      { date: "2026-10-10", received: 1, quoted: 1, clarified: 0 },
      { date: "2026-10-11", received: 1, quoted: 0, clarified: 1 },
      { date: "2026-10-12", received: 1, quoted: 1, clarified: 0 },
      { date: "2026-10-13", received: 1, quoted: 1, clarified: 0 },
      { date: "2026-10-14", received: 1, quoted: 0, clarified: 0 },
    ],
    medianProcessingSeconds: 38,
    deadLetterCount: 0,
  };

  // ---------------------------------------------------------------------------
  // System Health
  // ---------------------------------------------------------------------------
  const health: SystemHealth = {
    overall: "ok",
    checkedAt: "2026-10-14T09:45:00.000Z",
    components: [
      {
        id: "pricing-engine",
        name: "Deterministic Pricing Engine",
        level: "ok",
        detail: `Catalogue ${catalogue.version} active with ${catalogue.plans.length} plans and ${catalogue.addOns.length} add-ons`,
        latencyMs: 2,
      },
      {
        id: "inbound-pipeline",
        name: "Inbound Email Processing",
        level: "ok",
        detail: "Webhook ingress operational; parser queues healthy",
        latencyMs: 45,
      },
      {
        id: "ai-extractor",
        name: "Claude 3.5 Extraction Pipeline",
        level: "ok",
        detail: "Structured requirement extraction online (claude-3-5-sonnet-20241022)",
        latencyMs: 310,
      },
      {
        id: "outbound-mailer",
        name: "Email Delivery (Resend)",
        level: "ok",
        detail: "SMTP & API endpoints reachable; bounce handler active",
        latencyMs: 82,
      },
      {
        id: "database",
        name: "Operational Store",
        level: "ok",
        detail: "Fixture data store loaded and synced",
        latencyMs: 1,
      },
    ],
    outboundSendingPaused: false,
    environment: "local",
  };

  // ---------------------------------------------------------------------------
  // Integration Status
  // ---------------------------------------------------------------------------
  const integrations: IntegrationStatus[] = [
    {
      id: "int_inbound_resend",
      name: "Resend Inbound Webhook",
      category: "inbound_email",
      state: "demo_mode",
      detail:
        "Operating on seeded email fixtures; webhook endpoint ready for live payload ingestion",
      requiredEnvVars: ["RESEND_WEBHOOK_SECRET", "INBOUND_EMAIL_DOMAIN"],
      docsPath: "docs/integrations/inbound-email.md",
    },
    {
      id: "int_outbound_resend",
      name: "Resend Outbound Delivery",
      category: "outbound_email",
      state: "demo_mode",
      detail:
        "Configured in simulation mode with realistic delivery events and bounce handling",
      requiredEnvVars: ["RESEND_API_KEY", "OUTBOUND_FROM_EMAIL"],
      docsPath: "docs/integrations/outbound-email.md",
    },
    {
      id: "int_ai_anthropic",
      name: "Anthropic Claude Extraction",
      category: "ai",
      state: "demo_mode",
      detail:
        "Claude 3.5 Sonnet pipeline structured prompt definitions ready for API key activation",
      requiredEnvVars: ["ANTHROPIC_API_KEY"],
      docsPath: "docs/integrations/ai-extraction.md",
    },
    {
      id: "int_db_postgres",
      name: "PostgreSQL Database",
      category: "database",
      state: "demo_mode",
      detail:
        "In-memory domain store active; schema matches domain model specifications",
      requiredEnvVars: ["DATABASE_URL"],
      docsPath: "docs/integrations/database.md",
    },
    {
      id: "int_doc_pdf",
      name: "Quote Document Generator",
      category: "documents",
      state: "demo_mode",
      detail:
        "Client-side preview renderer active; server-side PDF generator configured",
      requiredEnvVars: [],
      docsPath: "docs/integrations/pdf-engine.md",
    },
    {
      id: "int_storage_s3",
      name: "S3 Compatible Object Storage",
      category: "storage",
      state: "demo_mode",
      detail:
        "Document artifact storage configured for attachment retention",
      requiredEnvVars: ["AWS_S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
      docsPath: "docs/integrations/storage.md",
    },
  ];

  return {
    threads,
    messages,
    profiles,
    quotes,
    deliveries,
    metrics,
    health,
    integrations,
  };
}

export function getSeedData(): SeedDataResult {
  if (!cachedSeedData) {
    cachedSeedData = createSeedData();
  }
  return cachedSeedData;
}
