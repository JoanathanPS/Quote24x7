import type {
  BillingPeriod,
  CurrencyCode,
  RequirementField,
  RequirementProfile,
  ClarificationQuestion,
} from "@/types/domain";
import { emptyDemand, type PricingDemand } from "../pricing/engine.ts";

export interface ExtractionInput {
  threadId: string;
  senderEmail: string;
  senderName: string | null;
  subject: string;
  bodyText: string;
}

export interface ExtractionResult {
  profile: RequirementProfile;
  demand: PricingDemand;
  isComplete: boolean;
  missingMaterialFields: string[];
  suggestedQuestion: ClarificationQuestion | null;
  organization: string | null;
  billingPeriod: BillingPeriod;
  currency: CurrencyCode;
  conversationalResponse?: string | null;
}

/**
 * Robust requirement extractor for Site24x7 monitoring inquiries.
 * Parses numerical requirements, units, evidence text, and detects material gaps
 * to determine whether a quote can be calculated immediately or needs clarification.
 */
export function extractRequirements(input: ExtractionInput): ExtractionResult {
  const text = `${input.subject}\n${input.bodyText}`;
  const lower = text.toLowerCase();

  const fields: RequirementField[] = [];
  const missingMaterialFields: string[] = [];

  // 1. Servers / Host Monitors
  let serverCount: number | null = null;
  let serverEvidence: string | null = null;
  const serverMentioned =
    /\b(?:servers?|hosts?|vms?|instances?|nodes?|machines?)\b/i.test(text);

  const serverMatch =
    text.match(/(\d+)\s*(?:[a-z\s]{0,35}?)\b(?:servers?|hosts?|vms?|instances?|nodes?|machines?)\b/i) ||
    text.match(/(?:servers?|hosts?|vms?|instances?|nodes?|machines?)[^:\n\r\d,|]{0,50}[:=,|\t]\s*(\d+)/i) ||
    text.match(/(?:servers?|hosts?|nodes?|instances?)\s*(?:count|total|:|=|,|\||\t)\s*(\d+)/i);

  if (serverMatch && serverMatch[1]) {
    serverCount = parseInt(serverMatch[1], 10);
    serverEvidence = serverMatch[0].trim();
    fields.push({
      key: "servers",
      label: "Server / Host Monitors",
      group: "infrastructure",
      value: serverCount,
      unit: "servers",
      state: "provided",
      confidence: 0.98,
      evidence: serverEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (serverMentioned) {
    missingMaterialFields.push("servers");
    fields.push({
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
    });
  }

  // 2. Network Devices / Interfaces
  let networkCount = 0;
  let networkEvidence: string | null = null;
  const netMentioned =
    /\b(?:network(?:\s+(?:devices?|switches?|routers?|components?|firewalls?|interfaces?))?|switches?|routers?|firewalls?)\b/i.test(text);

  const netMatch =
    text.match(/(\d+)\s*(?:[a-z\s]{0,30}?)\b(?:network(?:\s+devices?)?|switches?|routers?|firewalls?|interfaces?)\b/i) ||
    text.match(/(?:network(?:\s+devices?)?|switches?|routers?|firewalls?|interfaces?)[^:\n\r\d,|]{0,50}[:=,|\t]\s*(\d+)/i) ||
    text.match(/(?:network(?:\s+devices?)?|switches?|routers?)\s*(?:count|total|:|=|,|\||\t)\s*(\d+)/i);

  if (netMatch && netMatch[1]) {
    networkCount = parseInt(netMatch[1], 10);
    networkEvidence = netMatch[0].trim();
    fields.push({
      key: "network_devices",
      label: "Network Devices",
      group: "infrastructure",
      value: networkCount,
      unit: "devices",
      state: "provided",
      confidence: 0.95,
      evidence: networkEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (netMentioned) {
    missingMaterialFields.push("network_devices");
    fields.push({
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
      materialToPricing: true,
    });
  }

  // 3. Advanced / Synthetic Web Monitors & APM Applications
  let advancedCount = 0;
  let advancedEvidence: string | null = null;
  const advMentioned =
    /\b(?:synthetic(?:\s+(?:transaction|web|browser))?|advanced(?:\s+web)?|transaction|critical\s+web)\s*(?:monitors?|monitoring|endpoints?|checks?|urls?|apis?)\b/i.test(text) ||
    /\b(?:synthetic(?:\s+[a-z]+)?\s+monitoring)\b/i.test(text);

  const advMatch =
    text.match(/(\d+)\s*(?:[a-z\s]{0,35}?)\b(?:synthetic(?:\s+(?:transaction|web|browser))?|advanced(?:\s+web)?|transaction|critical\s+web)\s*(?:monitors?|endpoints?|urls?|checks?|apis?)\b/i) ||
    text.match(/(?:synthetic(?:\s+transaction|\s+web|\s+browser)?|advanced(?:\s+web)?|transaction)[^:\n\r\d,|]{0,50}[:=,|\t]\s*(\d+)/i) ||
    text.match(/(\d+)\s*(?:synthetic|advanced|transaction)\s*(?:(?:transaction|web|browser)\s+)?(?:monitors?|endpoints?|checks?|urls?|apis?)/i) ||
    text.match(/(?:advanced|synthetic|transaction)\s*(?:monitors?|endpoints?|checks?)\s*(?:count|total|:|=|,|\||\t)\s*(\d+)/i);

  const appApmMatch =
    text.match(/(\d+)\s*(?:[a-z\s]{0,15}?)\b(?:java|node(?:\.js)?|python|\.net|php|ruby|go)?\s*(?:apps?|applications?|apm(?:\s+instances?|\s+monitors?)?)\b/i) ||
    text.match(/(?:java|node(?:\.js)?|python|\.net|php|ruby|go|apm)\s*(?:apps?|applications?|instances?)\s*(?:count|total|:|=|,|\||\t)\s*(\d+)/i);

  if (advMatch && advMatch[1]) {
    advancedCount += parseInt(advMatch[1], 10);
    advancedEvidence = advMatch[0].trim();
  }
  if (appApmMatch && appApmMatch[1]) {
    const appCount = parseInt(appApmMatch[1], 10);
    advancedCount += appCount;
    advancedEvidence = advancedEvidence ? `${advancedEvidence}, ${appApmMatch[0].trim()}` : appApmMatch[0].trim();
  }

  if (advancedCount > 0) {
    fields.push({
      key: "advanced_monitors",
      label: "Advanced / Synthetic Monitors",
      group: "applications",
      value: advancedCount,
      unit: "monitors",
      state: "provided",
      confidence: 0.95,
      evidence: advancedEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (advMentioned) {
    missingMaterialFields.push("advanced_monitors");
    fields.push({
      key: "advanced_monitors",
      label: "Advanced / Synthetic Monitors",
      group: "applications",
      value: null,
      unit: "monitors",
      state: "missing",
      confidence: null,
      evidence: null,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  }

  // 4. Basic Monitors & Website Availability
  let basicCount = 0;
  let basicEvidence: string | null = null;
  const basicCountMatch =
    text.match(/(\d+)\s*(?:basic(?:\s+monitors?)?|ping(?:\s+monitors?)?|port(?:\s+monitors?)?|standard(?:\s+monitors?)?|websites?|urls?|web\s+sites?|website(?:\s+uptime|\s+availability)?(?:\s+monitors?|\s+checks?)?)\b/i) ||
    text.match(/(?:basic|ping|port|website\s+uptime|uptime\s+checks?)[^:\n\r\d]{0,50}[:=]\s*(\d+)/i) ||
    text.match(/(?:basic|ping|port|standard|websites?|urls?|web\s+sites?|website(?:\s+uptime)?)\s*(?:monitors?|checks?)\s*(?:count|total|:|=)\s*(\d+)/i);

  const websiteAvailabilityMentioned =
    /\b(?:website(?:\s+is|\s+being)?\s+accessible|website\s+uptime|website\s+availability|website\s+accessibility|check\s+(?:our\s+)?website|monitor(?:\s+whether)?\s+(?:our\s+)?website)\b/i.test(text) ||
    /\b(?:monitor(?:ing)?\s+(?:our\s+)?website)\b/i.test(text);

  const basicMentioned =
    /\b(?:basic|ping|port|standard)\s*monitors?\b/i.test(text) || websiteAvailabilityMentioned;

  if (basicCountMatch && basicCountMatch[1]) {
    basicCount = parseInt(basicCountMatch[1], 10);
    basicEvidence = basicCountMatch[0].trim();
    fields.push({
      key: "basic_monitors",
      label: "Basic Monitors",
      group: "applications",
      value: basicCount,
      unit: "monitors",
      state: "provided",
      confidence: 0.95,
      evidence: basicEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (websiteAvailabilityMentioned) {
    // Customer asked to check whether website is accessible without a specific count -> 1 basic website check
    basicCount = 1;
    const webMatch = text.match(/\b(?:website(?:\s+is|\s+being)?\s+accessible|website\s+uptime|website\s+availability|website\s+accessibility|monitor(?:\s+whether)?\s+(?:our\s+)?website)\b/i);
    basicEvidence = webMatch ? webMatch[0].trim() : "website accessibility monitoring";
    fields.push({
      key: "basic_monitors",
      label: "Basic Monitors",
      group: "applications",
      value: 1,
      unit: "monitors",
      state: "inferred",
      confidence: 0.92,
      evidence: basicEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (basicMentioned) {
    missingMaterialFields.push("basic_monitors");
    fields.push({
      key: "basic_monitors",
      label: "Basic Monitors",
      group: "applications",
      value: null,
      unit: "monitors",
      state: "missing",
      confidence: null,
      evidence: null,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  }

  // Explicit Website Monitoring feature field for visibility in requirement profile
  if (websiteAvailabilityMentioned) {
    const webEvidenceMatch = text.match(/\b(?:website(?:\s+is|\s+being)?\s+accessible|website\s+uptime|website\s+availability|website\s+accessibility|monitor(?:\s+whether)?\s+(?:our\s+)?website)\b/i);
    fields.push({
      key: "website_monitoring",
      label: "Website Availability Monitoring",
      group: "applications",
      value: "Website uptime & accessibility checks",
      unit: "checks",
      state: "provided",
      confidence: 0.95,
      evidence: webEvidenceMatch ? webEvidenceMatch[0].trim() : (basicEvidence || "website accessible"),
      conflictWith: null,
      previousValue: null,
      materialToPricing: false,
    });
  }

  // 4b. Application Performance Monitoring (APM Insight)
  const apmMentioned =
    /\b(?:application(?:\s+performance)?\s+monitoring|apm(?:\s+insight)?|business-critical\s+applications?|applications?\s+(?:that\s+are\s+)?business-critical)\b/i.test(text);

  if (apmMentioned) {
    const apmMatch = text.match(/\b(?:application(?:\s+performance)?\s+monitoring|apm(?:\s+insight)?|business-critical\s+applications?|applications?\s+(?:that\s+are\s+)?business-critical|few\s+applications\s+that\s+are\s+business-critical)\b/i);
    const apmEvidence = apmMatch ? apmMatch[0].trim() : "application monitoring";
    fields.push({
      key: "application_monitoring",
      label: "Application Performance Monitoring (APM)",
      group: "applications",
      value: "Business-critical application monitoring requested (unquantified instance count)",
      unit: "applications",
      state: "provided",
      confidence: 0.9,
      evidence: apmEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: false, // Does not block quote generation; base plans include APM or explain add-ons
    });
  }

  // 5. RUM Pageviews
  let rumPageviews = 0;
  let rumEvidence: string | null = null;
  const rumMentioned = /\b(?:rum|real\s+user\s+monitoring|pageviews?)\b/i.test(text);

  const rumMillionMatch =
    text.match(/(\d+(?:[.,]\d+)?)\s*(?:million\b|m\b)\s*(?:[a-z\s/]{0,25}?)\b(?:pageviews?|views?|rum)\b/i) ||
    text.match(/(?:rum|real\s+user\s+monitoring)\s*(?:[a-z\s]{0,25}?)\b(\d+(?:[.,]\d+)?)\s*(?:million\b|m\b)\s*(?:pageviews?|views?)?/i);
  const rumKMatch =
    text.match(/(\d+(?:[.,]\d+)?)\s*(?:thousand\b|k\b)\s*(?:[a-z\s/]{0,25}?)\b(?:pageviews?|views?|rum)\b/i);
  const rumColonMatch =
    text.match(/(?:rum|real\s+user\s+monitoring|pageviews?)[^:\n\r\d]{0,50}[:=]\s*(\d[\d,.]*)\s*(million|m|k|thousand)?/i);
  const rumRawMatch =
    text.match(/(\d{1,3}(?:,\d{3})+|\d{5,})\s*(?:[a-z\s/]{0,25}?)\b(?:pageviews?|views?|rum)\b/i);

  if (rumMillionMatch && rumMillionMatch[1]) {
    rumPageviews = Math.round(parseFloat(rumMillionMatch[1].replace(/,/g, "")) * 1_000_000);
    rumEvidence = rumMillionMatch[0].trim();
    fields.push({
      key: "rum_pageviews",
      label: "RUM Pageviews",
      group: "applications",
      value: rumPageviews,
      unit: "pageviews/month",
      state: "provided",
      confidence: 0.95,
      evidence: rumEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (rumKMatch && rumKMatch[1]) {
    rumPageviews = Math.round(parseFloat(rumKMatch[1].replace(/,/g, "")) * 1_000);
    rumEvidence = rumKMatch[0].trim();
    fields.push({
      key: "rum_pageviews",
      label: "RUM Pageviews",
      group: "applications",
      value: rumPageviews,
      unit: "pageviews/month",
      state: "provided",
      confidence: 0.95,
      evidence: rumEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (rumColonMatch && rumColonMatch[1]) {
    const rawVal = parseFloat(rumColonMatch[1].replace(/,/g, ""));
    const unit = (rumColonMatch[2] || "").toLowerCase();
    if (unit === "million" || unit === "m") {
      rumPageviews = Math.round(rawVal * 1_000_000);
    } else if (unit === "thousand" || unit === "k") {
      rumPageviews = Math.round(rawVal * 1_000);
    } else {
      rumPageviews = Math.round(rawVal);
    }
    rumEvidence = rumColonMatch[0].trim();
    fields.push({
      key: "rum_pageviews",
      label: "RUM Pageviews",
      group: "applications",
      value: rumPageviews,
      unit: "pageviews/month",
      state: "provided",
      confidence: 0.95,
      evidence: rumEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (rumRawMatch && rumRawMatch[1]) {
    rumPageviews = parseInt(rumRawMatch[1].replace(/,/g, ""), 10);
    rumEvidence = rumRawMatch[0].trim();
    fields.push({
      key: "rum_pageviews",
      label: "RUM Pageviews",
      group: "applications",
      value: rumPageviews,
      unit: "pageviews/month",
      state: "provided",
      confidence: 0.95,
      evidence: rumEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (rumMentioned) {
    missingMaterialFields.push("rum_pageviews");
    fields.push({
      key: "rum_pageviews",
      label: "RUM Pageviews",
      group: "applications",
      value: null,
      unit: "pageviews/month",
      state: "missing",
      confidence: null,
      evidence: null,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  }

  // 6. AppLogs Volume
  let applogGb = 0;
  let applogEvidence: string | null = null;
  const logMentioned =
    (/\b(?:applogs?|log\s+management)\b/i.test(text) || /\b(?:logs?)\b/i.test(text)) &&
    !/logistics|login|dialog|catalog/i.test(text);

  const logMatch =
    text.match(/(\d+)\s*(?:gb|gigabytes?|tb|terabytes?)\s*(?:[a-z\s/]{0,20}?)\b(?:applogs?|logs?)\b/i) ||
    text.match(/(?:applogs?|logs?|log\s+management)[^:\n\r\d]{0,50}[:=]\s*(\d+)\s*(?:gb|gigabytes?|tb|terabytes?)?/i) ||
    text.match(/(?:applogs?|logs?)\s*(?:volume|storage|size|retention)?\s*(?:of|:|=)?\s*(\d+)\s*(?:gb|gigabytes?|tb|terabytes?)/i);

  if (logMatch && logMatch[1]) {
    const isTb = logMatch[0].toLowerCase().includes("tb") || logMatch[0].toLowerCase().includes("terabyte");
    applogGb = parseInt(logMatch[1], 10) * (isTb ? 1024 : 1);
    applogEvidence = logMatch[0].trim();
    fields.push({
      key: "applogs_volume",
      label: "AppLogs Volume",
      group: "applications",
      value: applogGb,
      unit: "GB/month",
      state: "provided",
      confidence: 0.95,
      evidence: applogEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (logMentioned) {
    missingMaterialFields.push("applogs_volume");
    fields.push({
      key: "applogs_volume",
      label: "AppLogs Volume",
      group: "applications",
      value: null,
      unit: "GB/month",
      state: "missing",
      confidence: null,
      evidence: null,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  }

  // Primary Workload Scope check
  const hasPrimaryWorkload =
    serverCount !== null || networkCount > 0 || advancedCount > 0 || basicCount > 0;

  if (!hasPrimaryWorkload && !serverMentioned) {
    missingMaterialFields.push("servers");
    fields.push({
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
    });
  }

  // 7. Billing Period
  let billingPeriod: BillingPeriod = "annual";
  const billingMatch = text.match(/(?:billing|billed|payment|contract|subscription)[^:\n\r]{0,30}[:=]\s*(annual(?:ly)?|yearly|monthly)/i);
  if (billingMatch && billingMatch[1]) {
    billingPeriod = /annual|yearly/i.test(billingMatch[1]) ? "annual" : "monthly";
  } else if (/\b(?:annually|annual\s+billing|yearly\s+billing|annual\s+subscription)\b/i.test(lower)) {
    billingPeriod = "annual";
  } else if (/\b(?:month-to-month|monthly\s+billing|billed\s+monthly|monthly\s+subscription)\b/i.test(lower)) {
    billingPeriod = "monthly";
  } else if (lower.includes("annual")) {
    billingPeriod = "annual";
  } else if (lower.includes("monthly") && !lower.includes("monthly pageview") && !lower.includes("monthly applog") && !lower.includes("monthly rum")) {
    billingPeriod = "monthly";
  }
  fields.push({
    key: "billing_period",
    label: "Billing Period",
    group: "commercial",
    value: billingPeriod,
    unit: null,
    state: lower.includes("annual") || lower.includes("monthly") ? "provided" : "inferred",
    confidence: 0.9,
    evidence: lower.includes("annual") ? "annual" : lower.includes("monthly") ? "monthly" : "Default annual assumption",
    conflictWith: null,
    previousValue: null,
    materialToPricing: true,
  });

  // 8. Currency
  let currency: CurrencyCode = "INR";
  if (lower.includes("usd") || lower.includes("dollar") || lower.includes("$")) {
    currency = "USD";
  } else if (lower.includes("eur") || lower.includes("euro") || lower.includes("€")) {
    currency = "EUR";
  } else if (lower.includes("gbp") || lower.includes("pound") || lower.includes("£")) {
    currency = "GBP";
  }
  fields.push({
    key: "currency",
    label: "Currency",
    group: "commercial",
    value: currency,
    unit: null,
    state: "inferred",
    confidence: 0.85,
    evidence: "Market default or detected currency token",
    conflictWith: null,
    previousValue: null,
    materialToPricing: false,
  });

  // 9. Organization Detection
  let organization: string | null = null;
  const orgMatch =
    text.match(/(?:at|from|company|organization|org):\s*([A-Za-z0-9 \t&.,-]{3,40})/i) ||
    text.match(/(?:CTO|VP|Director|Manager|Lead|Engineer),\s*([A-Za-z0-9 \t&.,-]{3,40})/i);

  if (orgMatch && orgMatch[1]) {
    organization = orgMatch[1].trim();
  } else if (input.senderEmail.includes("@") && !input.senderEmail.endsWith("@gmail.com") && !input.senderEmail.endsWith("@yahoo.com")) {
    const domainPart = input.senderEmail.split("@")[1]?.split(".")[0];
    if (domainPart) {
      organization = domainPart.charAt(0).toUpperCase() + domainPart.slice(1);
    }
  }

  // --- Materiality & Gap Evaluation ---
  const isComplete = missingMaterialFields.length === 0 && hasPrimaryWorkload;

  let suggestedQuestion: ClarificationQuestion | null = null;
  if (!isComplete) {
    const missingDescriptions: string[] = [];
    if (missingMaterialFields.includes("servers")) {
      missingDescriptions.push("how many servers or virtual hosts you plan to monitor");
    }
    if (missingMaterialFields.includes("network_devices")) {
      missingDescriptions.push("how many network devices (switches, routers, firewalls) you need to monitor");
    }
    if (missingMaterialFields.includes("advanced_monitors")) {
      missingDescriptions.push("how many synthetic transaction or advanced web monitors you require");
    }
    if (missingMaterialFields.includes("basic_monitors")) {
      missingDescriptions.push("how many basic ping/port/website uptime checks you require");
    }
    if (missingMaterialFields.includes("rum_pageviews")) {
      missingDescriptions.push("your expected monthly Real User Monitoring (RUM) pageview volume");
    }
    if (missingMaterialFields.includes("applogs_volume")) {
      missingDescriptions.push("your expected monthly log management (AppLogs) volume in GB");
    }

    const question = `To calculate an accurate Site24x7 quotation, could you please specify: ${missingDescriptions.join("; ")}?`;

    suggestedQuestion = {
      id: `cq_${Date.now()}`,
      fieldKeys: [...missingMaterialFields],
      question,
      reason: `Required sizing parameters are missing: ${missingMaterialFields.join(", ")}.`,
      askedAt: new Date().toISOString(),
      answeredAt: null,
      answerSummary: null,
    };
  }

  const demand: PricingDemand = {
    ...emptyDemand(),
    host_monitor: serverCount ?? 0,
    network_component: networkCount,
    advanced_monitor: advancedCount,
    basic_monitor: basicCount,
    rum_pageview: rumPageviews,
    applog_gb: applogGb,
  };

  const hasWebsite = fields.some((f) => f.key === "website_monitoring");
  const hasApm = fields.some((f) => f.key === "application_monitoring");
  const extraNotes: string[] = [];
  if (hasWebsite) extraNotes.push("website availability monitoring");
  if (hasApm) extraNotes.push("business-critical APM");

  const summary = isComplete
    ? `Customer requests monitoring for ${serverCount ?? 0} servers, ${networkCount} network devices, ${advancedCount} advanced monitors, ${rumPageviews ? `${rumPageviews} RUM views` : "standard RUM"}, and ${applogGb ? `${applogGb}GB logs` : "standard logs"}${extraNotes.length > 0 ? ` (including ${extraNotes.join(" and ")})` : ""}.`
    : "Inquiry lacks required server/host counts for deterministic plan sizing.";

  const profile: RequirementProfile = {
    id: `prof_${Date.now()}`,
    threadId: input.threadId,
    version: 1,
    supersedesProfileId: null,
    createdAt: new Date().toISOString(),
    extractorModel: "quote24x7-extractor-v1.0.0",
    extractorRunId: `run_${Date.now()}`,
    fields,
    summary,
    pendingQuestions: suggestedQuestion ? [suggestedQuestion] : [],
    answeredQuestions: [],
    clarificationRound: suggestedQuestion ? 1 : 0,
  };

  return {
    profile,
    demand,
    isComplete,
    missingMaterialFields,
    suggestedQuestion,
    organization,
    billingPeriod,
    currency,
  };
}

export interface MergeRequirementsInput {
  existingProfile: RequirementProfile;
  replyText: string;
  senderEmail: string;
  senderName?: string | null;
  subject: string;
}

/**
 * Merges a buyer's reply into an existing requirement profile.
 * Preserves previously confirmed parameters, applies newly provided values,
 * updates answered questions, advances the profile version, and evaluates completeness.
 */
export function mergeRequirements(input: MergeRequirementsInput): ExtractionResult {
  const { existingProfile, replyText, senderEmail, senderName, subject } = input;
  const replyExtraction = extractRequirements({
    threadId: existingProfile.threadId,
    senderEmail,
    senderName: senderName ?? null,
    subject,
    bodyText: replyText,
  });

  const mergedFields: RequirementField[] = [];
  const newlyAnsweredQuestions: ClarificationQuestion[] = [];
  const remainingPendingQuestions: ClarificationQuestion[] = [];

  // Check if reply answers a pending question directly (e.g. "4", "4 monitors", "just 4")
  const pendingFieldKeys = new Set(
    existingProfile.pendingQuestions.flatMap((q) => q.fieldKeys)
  );

  const fallbackNumberMatch = replyText.match(/(?:need|have|want|use|about|around)?\s*(\d+)\s*(?:monitors?|endpoints?|checks?|servers?|hosts?|devices?|views?|pageviews?|gb)?/i);

  // Field keys to process
  const allKeys = [
    "servers",
    "network_devices",
    "advanced_monitors",
    "basic_monitors",
    "rum_pageviews",
    "applogs_volume",
    "website_monitoring",
    "application_monitoring",
    "billing_period",
    "currency",
  ];

  for (const key of allKeys) {
    const existingField = existingProfile.fields.find((f) => f.key === key);
    let replyField = replyExtraction.profile.fields.find((f) => f.key === key);

    // If reply did not extract this field with standard regex, check if it answers a pending question
    if (
      (!replyField || replyField.state === "missing") &&
      pendingFieldKeys.has(key) &&
      fallbackNumberMatch &&
      fallbackNumberMatch[1]
    ) {
      const val = parseInt(fallbackNumberMatch[1], 10);
      replyField = {
        key,
        label: existingField?.label || key,
        group: existingField?.group || "infrastructure",
        value: val,
        unit: existingField?.unit || null,
        state: "provided",
        confidence: 0.9,
        evidence: fallbackNumberMatch[0].trim(),
        conflictWith: null,
        previousValue: existingField?.value ?? null,
        materialToPricing: true,
      };
    }

    if (replyField && replyField.state === "provided") {
      const previousValue =
        existingField && existingField.value !== replyField.value
          ? existingField.value
          : existingField?.previousValue ?? null;

      mergedFields.push({
        ...replyField,
        previousValue,
      });
    } else if (existingField && (existingField.state === "provided" || existingField.state === "inferred")) {
      mergedFields.push({ ...existingField });
    } else if (replyField) {
      mergedFields.push({ ...replyField });
    } else if (existingField) {
      mergedFields.push({ ...existingField });
    }
  }

  // Preserve any additional fields from earlier turns or reply
  const processedKeys = new Set(allKeys);
  for (const existingField of existingProfile.fields) {
    if (!processedKeys.has(existingField.key) && !mergedFields.some((f) => f.key === existingField.key)) {
      mergedFields.push({ ...existingField });
    }
  }
  for (const replyField of replyExtraction.profile.fields) {
    if (!processedKeys.has(replyField.key) && !mergedFields.some((f) => f.key === replyField.key)) {
      mergedFields.push({ ...replyField });
    }
  }

  // Evaluate which pending questions have been answered
  for (const question of existingProfile.pendingQuestions) {
    const allAnswered = question.fieldKeys.every((key) => {
      const f = mergedFields.find((field) => field.key === key);
      return f && f.state === "provided" && f.value !== null;
    });

    if (allAnswered) {
      const answers = question.fieldKeys
        .map((k) => `${k}: ${mergedFields.find((f) => f.key === k)?.value}`)
        .join("; ");
      newlyAnsweredQuestions.push({
        ...question,
        answeredAt: new Date().toISOString(),
        answerSummary: `Clarified by buyer: ${answers}`,
      });
    } else {
      remainingPendingQuestions.push(question);
    }
  }

  // Identify remaining missing material fields
  const missingMaterialFields: string[] = [];
  const serverField = mergedFields.find((f) => f.key === "servers");
  const netField = mergedFields.find((f) => f.key === "network_devices");
  const advField = mergedFields.find((f) => f.key === "advanced_monitors");
  const basicField = mergedFields.find((f) => f.key === "basic_monitors");

  for (const field of mergedFields) {
    if (field.state === "missing" && field.materialToPricing) {
      if (!missingMaterialFields.includes(field.key)) {
        missingMaterialFields.push(field.key);
      }
    }
  }

  const hasPrimaryWorkload = Boolean(
    (serverField && serverField.state === "provided" && Number(serverField.value) > 0) ||
    (netField && netField.state === "provided" && Number(netField.value) > 0) ||
    (advField && advField.state === "provided" && Number(advField.value) > 0) ||
    (basicField && basicField.state === "provided" && Number(basicField.value) > 0)
  );

  if (!hasPrimaryWorkload && !missingMaterialFields.includes("servers")) {
    missingMaterialFields.push("servers");
  }

  const isComplete: boolean = missingMaterialFields.length === 0 && hasPrimaryWorkload;

  let suggestedQuestion: ClarificationQuestion | null = null;
  if (!isComplete) {
    const missingDescriptions: string[] = [];
    if (missingMaterialFields.includes("servers")) {
      missingDescriptions.push("how many servers or virtual hosts you plan to monitor");
    }
    if (missingMaterialFields.includes("network_devices")) {
      missingDescriptions.push("how many network devices you need to monitor");
    }
    if (missingMaterialFields.includes("advanced_monitors")) {
      missingDescriptions.push("how many synthetic transaction or advanced web monitors you require");
    }
    if (missingMaterialFields.includes("basic_monitors")) {
      missingDescriptions.push("how many basic ping/port checks you require");
    }
    if (missingMaterialFields.includes("rum_pageviews")) {
      missingDescriptions.push("your monthly RUM pageview volume");
    }
    if (missingMaterialFields.includes("applogs_volume")) {
      missingDescriptions.push("your monthly log volume in GB");
    }

    suggestedQuestion = {
      id: `cq_${Date.now()}`,
      fieldKeys: [...missingMaterialFields],
      question: `To finalize your quotation, could you please clarify: ${missingDescriptions.join("; ")}?`,
      reason: `Remaining missing parameters: ${missingMaterialFields.join(", ")}.`,
      askedAt: new Date().toISOString(),
      answeredAt: null,
      answerSummary: null,
    };
    remainingPendingQuestions.push(suggestedQuestion);
  }

  const serverCount = Number(mergedFields.find((f) => f.key === "servers")?.value ?? 0);
  const networkCount = Number(mergedFields.find((f) => f.key === "network_devices")?.value ?? 0);
  const advancedCount = Number(mergedFields.find((f) => f.key === "advanced_monitors")?.value ?? 0);
  const basicCount = Number(mergedFields.find((f) => f.key === "basic_monitors")?.value ?? 0);
  const rumPageviews = Number(mergedFields.find((f) => f.key === "rum_pageviews")?.value ?? 0);
  const applogGb = Number(mergedFields.find((f) => f.key === "applogs_volume")?.value ?? 0);

  const demand: PricingDemand = {
    ...emptyDemand(),
    host_monitor: serverCount,
    network_component: networkCount,
    advanced_monitor: advancedCount,
    basic_monitor: basicCount,
    rum_pageview: rumPageviews,
    applog_gb: applogGb,
  };

  const hasWebsite = mergedFields.some((f) => f.key === "website_monitoring");
  const hasApm = mergedFields.some((f) => f.key === "application_monitoring");
  const extraNotes: string[] = [];
  if (hasWebsite) extraNotes.push("website availability monitoring");
  if (hasApm) extraNotes.push("business-critical APM");

  const summary = isComplete
    ? `Customer requests monitoring for ${serverCount} servers, ${networkCount} network devices, ${advancedCount} advanced monitors, ${rumPageviews ? `${rumPageviews} RUM views` : "standard RUM"}, and ${applogGb ? `${applogGb}GB logs` : "standard logs"}${extraNotes.length > 0 ? ` (including ${extraNotes.join(" and ")})` : ""}.`
    : `Inquiry partially clarified (round ${existingProfile.clarificationRound + 1}); still missing: ${missingMaterialFields.join(", ")}.`;

  const profile: RequirementProfile = {
    id: `prof_${Date.now()}`,
    threadId: existingProfile.threadId,
    version: existingProfile.version + 1,
    supersedesProfileId: existingProfile.id,
    createdAt: new Date().toISOString(),
    extractorModel: "quote24x7-extractor-v1.0.0",
    extractorRunId: `run_${Date.now()}`,
    fields: mergedFields,
    summary,
    pendingQuestions: remainingPendingQuestions,
    answeredQuestions: [
      ...existingProfile.answeredQuestions,
      ...newlyAnsweredQuestions,
    ],
    clarificationRound: existingProfile.clarificationRound + 1,
  };

  const billingPeriod =
    (mergedFields.find((f) => f.key === "billing_period")?.value as BillingPeriod) || "annual";
  const currency =
    (mergedFields.find((f) => f.key === "currency")?.value as CurrencyCode) || "INR";

  return {
    profile,
    demand,
    isComplete,
    missingMaterialFields,
    suggestedQuestion,
    organization: replyExtraction.organization || null,
    billingPeriod,
    currency,
  };
}
