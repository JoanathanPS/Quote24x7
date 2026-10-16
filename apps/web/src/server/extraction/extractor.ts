import type {
  BillingPeriod,
  CurrencyCode,
  RequirementField,
  RequirementProfile,
  ClarificationQuestion,
  IntakeUnit,
  IntakeUnitState,
  IntakeRequirement,
  EmailTriageCategory,
  OptionalRequirementParameters,
} from "@/types/domain";
import { emptyDemand, type PricingDemand } from "../pricing/engine.ts";

export const INTAKE_UNITS: readonly IntakeUnit[] = [
  "host_monitor",
  "basic_monitor",
  "advanced_monitor",
  "network_component",
  "rum_pageview",
  "applog_gb",
] as const;

export const UNIT_TO_FIELD_KEY: Record<IntakeUnit, string> = {
  host_monitor: "servers",
  basic_monitor: "basic_monitors",
  advanced_monitor: "advanced_monitors",
  network_component: "network_devices",
  rum_pageview: "rum_pageviews",
  applog_gb: "applogs_volume",
};

export const FIELD_KEY_TO_UNIT: Record<string, IntakeUnit> = {
  servers: "host_monitor",
  basic_monitors: "basic_monitor",
  advanced_monitors: "advanced_monitor",
  network_devices: "network_component",
  rum_pageviews: "rum_pageview",
  applogs_volume: "applog_gb",
};

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
  triageCategory: EmailTriageCategory;
  isSubstantive: boolean;
  intakeRequirements: Record<IntakeUnit, IntakeRequirement>;
  optionalParameters: OptionalRequirementParameters;
}

/**
 * Triages an incoming email into one of four distinct categories:
 * - actionable_rfq: has at least one monitoring need mentioned
 * - vague_inquiry: broad interest with no quantities or specifics
 * - non_substantive: "hi", "thanks", "ok", bounces, auto-replies, out-of-office, unsubscribe, vendor solicitations
 * - unsupported: reseller request, RFP attachment, non-India market, feature request
 */
export function triageInboundEmail(
  subject: string,
  bodyText: string,
  _from?: string,
): EmailTriageCategory {
  const combined = `${subject}\n${bodyText}`.toLowerCase();
  const cleanBody = bodyText.trim().toLowerCase();

  // 1. Unsupported: reseller request, RFP attachment, non-India market, feature request
  const isReseller =
    /\b(?:reseller|partner\s+discount|partner\s+margin|white-?label|partner\s+program|become\s+a\s+partner|distributor|deal\s+registration)\b/i.test(
      combined,
    );
  const isRfp =
    /\b(?:attached\s+rfp|rfp\s+attached|tender\s+doc(?:ument)?|formal\s+rfp|bid\s+submission|request\s+for\s+proposal)\b/i.test(
      combined,
    );
  const isNonIndia =
    /\b(?:us\s+pricing|dollar\s+pricing|usd|\$|in\s+dollars|eur|€|quote\s+in\s+eur|gbp|£|outside\s+india|non-india|united\s+states\s+pricing)\b/i.test(
      combined,
    ) && !/\binr|rupee|₹\b/i.test(combined);
  const isFeatureRequest =
    /\b(?:feature\s+request|can\s+you\s+build\s+feature|custom\s+feature\s+development|need\s+a\s+custom\s+feature|please\s+add\s+support\s+for)\b/i.test(
      combined,
    );

  if (isReseller || isRfp || isNonIndia || isFeatureRequest) {
    return "unsupported";
  }

  // 2. Non-substantive: "hi", "thanks", "ok", bounces, auto-replies, out-of-office, unsubscribe, vendor solicitations
  const isBounceOrAuto =
    /\b(?:out\s+of\s+(?:the\s+)?office|auto-?reply|automatic\s+reply|mailer-daemon|delivery\s+status\s+notification|undelivered\s+mail|failure\s+notice)\b/i.test(
      combined,
    );
  const isUnsubscribe = /\b(?:unsubscribe|stop\s+emails|opt-?out)\b/i.test(combined);
  const isVendorSolicitation =
    /\b(?:seo\s+services?|guest\s+post|hire\s+(?:offshore|remote)\s+developers?|lead\s+generation\s+services?|software\s+development\s+agency)\b/i.test(
      combined,
    );
  const isShortPleasantry =
    /^(?:hi|hello|hey|greetings|thanks|thank\s+you|thx|ok|okay|k|noted|received|acknowledged|cool|sure|got\s+it|sounds\s+good|ok\s+sounds\s+good|all\s+good|fine)[.!]?$/i.test(
      cleanBody,
    ) ||
    (cleanBody.length < 40 &&
      /^(?:(?:hi|hello|thanks|thank\s+you|ok|okay|sure|cool|got\s+it|noted|sounds\s+good)[,\s.!]*)+$/i.test(
        cleanBody,
      ));

  if (isBounceOrAuto || isUnsubscribe || isVendorSolicitation || isShortPleasantry) {
    return "non_substantive";
  }

  // 3. Actionable RFQ: has at least one monitoring need mentioned
  const hasMonitoringNeed =
    /\b(?:servers?|hosts?|vms?|virtual\s+machines?|instances?|nodes?|machines?|linux|windows)\b/i.test(
      combined,
    ) ||
    /\b(?:websites?|urls?|endpoints?|apis?|rest\s+apis?|ping|port|uptime|http)\b/i.test(
      combined,
    ) ||
    /\b(?:synthetic|transactions?|browser\s+checks?|journeys?)\b/i.test(combined) ||
    /\b(?:network|switches?|routers?|firewalls?|snmp|interfaces?|components?)\b/i.test(
      combined,
    ) ||
    /\b(?:rum|real\s+user|pageviews?)\b/i.test(combined) ||
    /\b(?:logs?|applogs?|log\s+management)\b/i.test(combined) ||
    /\b(?:apm|application\s+performance)\b/i.test(combined);

  if (hasMonitoringNeed) {
    return "actionable_rfq";
  }

  // 4. Vague inquiry: broad interest with no quantities or specifics
  return "vague_inquiry";
}

/**
 * Checks whether all 6 intake units are either stated (quantity >= 0) or none.
 * Never quote while any of the 6 is unknown.
 */
export function isSufficientToQuote(
  intake: Record<IntakeUnit, IntakeRequirement>,
): boolean {
  return INTAKE_UNITS.every(
    (unit) => intake[unit]?.state === "stated" || intake[unit]?.state === "none",
  );
}

/**
 * Combines missing intake units into at most 3 clear, numbered questions.
 * Never mentions any prices, estimates, or ranges.
 */
export function buildClarificationQuestions(unknownUnits: IntakeUnit[]): string[] {
  if (unknownUnits.length === 0) return [];

  const questions: string[] = [];

  const hasHost = unknownUnits.includes("host_monitor");
  const hasNet = unknownUnits.includes("network_component");
  const hasBasic = unknownUnits.includes("basic_monitor");
  const hasAdv = unknownUnits.includes("advanced_monitor");
  const hasRum = unknownUnits.includes("rum_pageview");
  const hasLog = unknownUnits.includes("applog_gb");

  // Question 1: Infrastructure (servers / network devices)
  if (hasHost && hasNet) {
    questions.push(
      "How many servers (Linux, Windows, or VMs) and network devices (switches, routers, firewalls) do you need to monitor?",
    );
  } else if (hasHost) {
    questions.push(
      "How many servers (Linux, Windows, or virtual machines) do you plan to monitor?",
    );
  } else if (hasNet) {
    questions.push(
      "Do you have network devices (switches, routers, firewalls) to monitor, and if so, how many?",
    );
  }

  // Question 2: Web & Applications (websites/URLs/APIs & synthetic transactions)
  if (hasBasic && hasAdv) {
    questions.push(
      "How many websites, URLs, or API endpoints do you need to check, and do you require multi-step synthetic transaction monitoring?",
    );
  } else if (hasBasic) {
    questions.push(
      "How many websites, URLs, or API endpoints do you need to monitor for uptime and performance?",
    );
  } else if (hasAdv) {
    questions.push(
      "Do you require synthetic transaction monitoring (multi-step user journeys / browser checks), and if so, how many?",
    );
  }

  // Question 3: Real User Monitoring & Logs
  if (hasRum && hasLog) {
    questions.push(
      "Do you require Real User Monitoring (estimated monthly pageviews) or log management (GB/month or GB/day)?",
    );
  } else if (hasRum) {
    questions.push(
      "What is your estimated monthly pageview volume for Real User Monitoring (RUM), or is this not needed?",
    );
  } else if (hasLog) {
    questions.push(
      "What is your expected monthly log management volume (in GB/month or GB/day), or are logs not required?",
    );
  }

  // At most 3 numbered questions
  return questions.slice(0, 3).map((q, idx) => `${idx + 1}. ${q}`);
}

/**
 * Checks whether an incoming message is substantive.
 * Substantive means: contains an answer to a pending question, or introduces
 * a new requirement, or amends an existing one.
 */
export function isSubstantiveEmail(
  replyText: string,
  priorProfile?: RequirementProfile,
): boolean {
  const lower = replyText.trim().toLowerCase();

  // Non-substantive indicators
  if (
    /^(?:hi|hello|hey|greetings|thanks|thank\s+you|thx|ok|okay|k|noted|received|acknowledged|cool|sure|got\s+it|sounds\s+good)[.!]?$/i.test(
      lower,
    ) ||
    lower.length < 20
  ) {
    const hasNumber = /\b\d+\b/.test(lower);
    if (!hasNumber) return false;
  }

  // Non-productive stalling phrases
  if (
    /\b(?:still\s+discussing|will\s+get\s+back|let\s+you\s+know|internal\s+meeting|discussing\s+with\s+team|thinking\s+about\s+it|check\s+later)\b/i.test(
      lower,
    ) &&
    !/\b\d+\b/.test(lower)
  ) {
    return false;
  }

  // Contains numbers or counts
  if (/\b\d+\b/.test(lower)) {
    return true;
  }

  // Explicitly rules out categories ("none", "not needed", "just servers", "no websites")
  if (
    /\b(?:none|not\s+needed|no\s+(?:websites?|servers?|apps?|logs?|network|synthetic|rum)|just\s+servers?|only\s+servers?|nothing\s+else)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  // Answers a pending question
  if (priorProfile && priorProfile.pendingQuestions.length > 0) {
    for (const q of priorProfile.pendingQuestions) {
      for (const key of q.fieldKeys) {
        if (lower.includes(key.replace(/_/g, " "))) return true;
      }
    }
  }

  return false;
}

/**
 * Robust requirement extractor for Site24x7 monitoring inquiries.
 * Tracks the 6 billable intake units in state: stated, none, or unknown.
 */
export function extractRequirements(input: ExtractionInput): ExtractionResult {
  const text = `${input.subject}\n${input.bodyText}`;
  const lower = text.toLowerCase();

  const triageCategory = triageInboundEmail(input.subject, input.bodyText, input.senderEmail);
  const fields: RequirementField[] = [];
  const missingMaterialFields: string[] = [];

  // Global "just servers" / "only servers" check
  const serversOnly =
    /\b(?:only\s+(?:need\s+)?servers?|just\s+servers?|servers?\s+only|solely\s+servers?|strictly\s+servers?|all\s+we\s+need\s+is\s+servers?)\b/i.test(
      lower,
    );

  // Global "no other needs" check
  const noOtherNeeds =
    /\b(?:no\s+other\s+(?:monitoring|needs?|requirements?|checks?|services?)|nothing\s+else|no\s+others?)\b/i.test(
      lower,
    );

  // 1. Servers / Host Monitors
  let serverCount: number | null = null;
  let serverEvidence: string | null = null;
  let serverState: IntakeUnitState = "unknown";

  const serverNone =
    /\b(?:no\s+servers?|zero\s+servers?|0\s+servers?|don'?t\s+need\s+servers?|servers?\s*:\s*(?:none|0|no))\b/i.test(
      lower,
    );
  const serverMentioned =
    /\b(?:servers?|hosts?|vms?|instances?|nodes?|machines?)\b/i.test(text);

  const serverMatch =
    text.match(
      /(\d+)\s*(?:[a-z\s]{0,35}?)\b(?:servers?|hosts?|vms?|instances?|nodes?|machines?)\b/i,
    ) ||
    text.match(
      /(?:servers?|hosts?|vms?|instances?|nodes?|machines?)[^:\n\r\d,|]{0,50}[:=,|\t]\s*(\d+)/i,
    ) ||
    text.match(
      /(?:servers?|hosts?|nodes?|instances?)\s*(?:count|total|:|=|,|\||\t)\s*(\d+)/i,
    );

  if (serverNone) {
    serverCount = 0;
    serverState = "none";
    serverEvidence = "Explicitly stated no servers needed";
    fields.push({
      key: "servers",
      label: "Server / Host Monitors",
      group: "infrastructure",
      value: 0,
      unit: "servers",
      state: "provided",
      intakeState: "none",
      confidence: 0.99,
      evidence: serverEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (serverMatch && serverMatch[1]) {
    serverCount = parseInt(serverMatch[1], 10);
    serverState = "stated";
    serverEvidence = serverMatch[0].trim();
    fields.push({
      key: "servers",
      label: "Server / Host Monitors",
      group: "infrastructure",
      value: serverCount,
      unit: "servers",
      state: "provided",
      intakeState: "stated",
      confidence: 0.98,
      evidence: serverEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (serverMentioned) {
    serverState = "unknown";
    missingMaterialFields.push("servers");
    fields.push({
      key: "servers",
      label: "Server / Host Monitors",
      group: "infrastructure",
      value: null,
      unit: "servers",
      state: "missing",
      intakeState: "unknown",
      confidence: null,
      evidence: null,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  }

  // 2. Network Devices / Interfaces
  let networkCount: number | null = null;
  let networkEvidence: string | null = null;
  let networkState: IntakeUnitState = "unknown";

  const netMentioned =
    /\b(?:network(?:\s+(?:devices?|switches?|routers?|components?|firewalls?|interfaces?))?|switches?|routers?|firewalls?)\b/i.test(
      text,
    );

  const netMatch =
    text.match(
      /(\d+)\s*(?:[a-z\s]{0,30}?)\b(?:network(?:\s+devices?)?|switches?|routers?|firewalls?|interfaces?)\b/i,
    ) ||
    text.match(
      /(?:network(?:\s+devices?)?|switches?|routers?|firewalls?|interfaces?)[^:\n\r\d,|]{0,50}[:=,|\t]\s*(\d+)/i,
    ) ||
    text.match(
      /(?:network(?:\s+devices?)?|switches?|routers?)\s*(?:count|total|:|=|,|\||\t)\s*(\d+)/i,
    );

  const netNone =
    serversOnly ||
    (noOtherNeeds && !netMentioned) ||
    /\b(?:no\s+network(?:\s+devices?)?|zero\s+network|0\s+network|don'?t\s+need\s+network|network\s*:\s*(?:none|0|no)|no\s+(?:switches|routers|firewalls))\b/i.test(
      lower,
    );

  if (netNone) {
    networkCount = 0;
    networkState = "none";
    networkEvidence = serversOnly ? "Excluded via servers-only rule" : "Explicitly stated no network devices";
    fields.push({
      key: "network_devices",
      label: "Network Devices",
      group: "infrastructure",
      value: 0,
      unit: "devices",
      state: "provided",
      intakeState: "none",
      confidence: 0.99,
      evidence: networkEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (netMatch && netMatch[1]) {
    networkCount = parseInt(netMatch[1], 10);
    networkState = "stated";
    networkEvidence = netMatch[0].trim();
    fields.push({
      key: "network_devices",
      label: "Network Devices",
      group: "infrastructure",
      value: networkCount,
      unit: "devices",
      state: "provided",
      intakeState: "stated",
      confidence: 0.95,
      evidence: networkEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (netMentioned) {
    networkState = "unknown";
    missingMaterialFields.push("network_devices");
    fields.push({
      key: "network_devices",
      label: "Network Devices",
      group: "infrastructure",
      value: null,
      unit: "devices",
      state: "missing",
      intakeState: "unknown",
      confidence: null,
      evidence: null,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  }

  // 3. Basic Monitors & Websites / URLs / APIs
  let basicCount: number | null = null;
  let basicEvidence: string | null = null;
  let basicState: IntakeUnitState = "unknown";

  const basicCountMatch =
    text.match(
      /(\d+)\s*(?:basic(?:\s+monitors?)?|ping(?:\s+monitors?)?|port(?:\s+monitors?)?|standard(?:\s+monitors?)?|websites?|urls?|web\s+sites?|apis?|api\s+endpoints?|rest\s+apis?|endpoints?|website(?:\s+uptime|\s+availability)?(?:\s+monitors?|\s+checks?)?)\b/i,
    ) ||
    text.match(
      /(?:basic|ping|port|website\s+uptime|uptime\s+checks?|websites?|urls?|apis?)[^:\n\r\d]{0,50}[:=]\s*(\d+)/i,
    ) ||
    text.match(
      /(?:basic|ping|port|standard|websites?|urls?|web\s+sites?|apis?|website(?:\s+uptime)?)\s*(?:monitors?|checks?)\s*(?:count|total|:|=)\s*(\d+)/i,
    );

  const websiteAvailabilityMentioned =
    /\b(?:website(?:\s+is|\s+being)?\s+accessible|website\s+uptime|website\s+downtime|website\s+(?:going\s+)?down|website\s+availability|website\s+accessibility|check\s+(?:our\s+)?website|monitor(?:\s+whether)?\s+(?:our\s+)?website)\b/i.test(
      text,
    ) || /\b(?:monitor(?:ing)?\s+(?:our\s+)?website)\b/i.test(text);

  const basicMentioned =
    /\b(?:basic|ping|port|standard)\s*monitors?\b/i.test(text) ||
    /\b(?:websites?|urls?|apis?)\b/i.test(text) ||
    websiteAvailabilityMentioned;

  const basicNone =
    serversOnly ||
    (noOtherNeeds && !basicMentioned) ||
    /\b(?:no\s+(?:websites?|urls?|apis?)|zero\s+(?:websites?|urls?|apis?)|0\s+(?:websites?|urls?|apis?)|don'?t\s+need\s+(?:websites?|urls?|apis?)|(?:websites?|urls?|apis?)\s*:\s*(?:none|0|no))\b/i.test(
      lower,
    );

  if (basicNone) {
    basicCount = 0;
    basicState = "none";
    basicEvidence = serversOnly ? "Excluded via servers-only rule" : "Explicitly stated no websites/APIs";
    fields.push({
      key: "basic_monitors",
      label: "Basic Monitors",
      group: "applications",
      value: 0,
      unit: "monitors",
      state: "provided",
      intakeState: "none",
      confidence: 0.99,
      evidence: basicEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (basicCountMatch && basicCountMatch[1]) {
    basicCount = parseInt(basicCountMatch[1], 10);
    basicState = "stated";
    basicEvidence = basicCountMatch[0].trim();
    fields.push({
      key: "basic_monitors",
      label: "Basic Monitors",
      group: "applications",
      value: basicCount,
      unit: "monitors",
      state: "provided",
      intakeState: "stated",
      confidence: 0.95,
      evidence: basicEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (websiteAvailabilityMentioned) {
    basicCount = 1;
    basicState = "stated";
    const webMatch = text.match(
      /\b(?:website(?:\s+is|\s+being)?\s+accessible|website\s+uptime|website\s+availability|website\s+accessibility|monitor(?:\s+whether)?\s+(?:our\s+)?website)\b/i,
    );
    basicEvidence = webMatch ? webMatch[0].trim() : "website accessibility monitoring";
    fields.push({
      key: "basic_monitors",
      label: "Basic Monitors",
      group: "applications",
      value: 1,
      unit: "monitors",
      state: "inferred",
      intakeState: "stated",
      confidence: 0.92,
      evidence: basicEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
    fields.push({
      key: "website_monitoring",
      label: "Website Availability Monitoring",
      group: "applications",
      value: "Website accessibility check requested",
      unit: "websites",
      state: "provided",
      confidence: 0.95,
      evidence: basicEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: false,
    });
  } else if (basicMentioned) {
    basicState = "unknown";
    missingMaterialFields.push("basic_monitors");
    fields.push({
      key: "basic_monitors",
      label: "Basic Monitors",
      group: "applications",
      value: null,
      unit: "monitors",
      state: "missing",
      intakeState: "unknown",
      confidence: null,
      evidence: null,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  }

  // 4. Advanced / Synthetic Monitors (multi-step user transactions)
  let advancedCount: number | null = null;
  let advancedEvidence: string | null = null;
  let advancedState: IntakeUnitState = "unknown";

  const advMentioned =
    /\b(?:synthetic(?:\s+(?:transaction|web|browser))?|advanced(?:\s+web)?|transaction|critical\s+web)\s*(?:monitors?|monitoring|endpoints?|checks?|urls?|apis?)\b/i.test(
      text,
    ) || /\b(?:synthetic(?:\s+[a-z]+)?\s+monitoring)\b/i.test(text);

  const advMatch =
    text.match(
      /(\d+)\s*(?:[a-z\s]{0,35}?)\b(?:synthetic(?:\s+(?:transaction|web|browser))?|advanced(?:\s+web)?|transaction|critical\s+web)\s*(?:monitors?|endpoints?|urls?|checks?|apis?)\b/i,
    ) ||
    text.match(
      /(?:synthetic(?:\s+transaction|\s+web|\s+browser)?|advanced(?:\s+web)?|transaction)[^:\n\r\d]{0,50}[:=]\s*(\d+)/i,
    ) ||
    text.match(
      /(\d+)\s*(?:synthetic|advanced|transaction)\s*(?:(?:transaction|web|browser)\s+)?(?:monitors?|endpoints?|checks?|urls?|apis?)/i,
    ) ||
    text.match(
      /(?:advanced|synthetic|transaction)\s*(?:monitors?|endpoints?|checks?)\s*(?:count|total|:|=)\s*(\d+)/i,
    );

  const appApmMatch =
    text.match(
      /(\d+)\s*(?:[a-z\s]{0,15}?)\b(?:java|node(?:\.js)?|python|\.net|php|ruby|go)?\s*(?:apps?|applications?|apm(?:\s+instances?|\s+monitors?)?)\b/i,
    ) ||
    text.match(
      /(?:java|node(?:\.js)?|python|\.net|php|ruby|go|apm)\s*(?:apps?|applications?|instances?)\s*(?:count|total|:|=)\s*(\d+)/i,
    );

  const advNone =
    serversOnly ||
    (noOtherNeeds && !advMentioned && !appApmMatch) ||
    /\b(?:no\s+synthetic|zero\s+synthetic|0\s+synthetic|don'?t\s+need\s+synthetic|synthetic\s*:\s*(?:none|0|no)|no\s+advanced\s+monitors?)\b/i.test(
      lower,
    );

  if (advNone) {
    advancedCount = 0;
    advancedState = "none";
    advancedEvidence = serversOnly ? "Excluded via servers-only rule" : "Explicitly stated no synthetic monitors";
    fields.push({
      key: "advanced_monitors",
      label: "Advanced / Synthetic Monitors",
      group: "applications",
      value: 0,
      unit: "monitors",
      state: "provided",
      intakeState: "none",
      confidence: 0.99,
      evidence: advancedEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (advMatch && advMatch[1]) {
    advancedCount = parseInt(advMatch[1], 10);
    if (appApmMatch && appApmMatch[1]) {
      advancedCount += parseInt(appApmMatch[1], 10);
    }
    advancedState = "stated";
    advancedEvidence = advMatch[0].trim();
    fields.push({
      key: "advanced_monitors",
      label: "Advanced / Synthetic Monitors",
      group: "applications",
      value: advancedCount,
      unit: "monitors",
      state: "provided",
      intakeState: "stated",
      confidence: 0.95,
      evidence: advancedEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (appApmMatch && appApmMatch[1]) {
    advancedCount = parseInt(appApmMatch[1], 10);
    advancedState = "stated";
    advancedEvidence = appApmMatch[0].trim();
    fields.push({
      key: "advanced_monitors",
      label: "Advanced / Synthetic Monitors",
      group: "applications",
      value: advancedCount,
      unit: "monitors",
      state: "provided",
      intakeState: "stated",
      confidence: 0.95,
      evidence: advancedEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (advMentioned) {
    advancedState = "unknown";
    missingMaterialFields.push("advanced_monitors");
    fields.push({
      key: "advanced_monitors",
      label: "Advanced / Synthetic Monitors",
      group: "applications",
      value: null,
      unit: "monitors",
      state: "missing",
      intakeState: "unknown",
      confidence: null,
      evidence: null,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  }

  // Explicit APM capability flag
  const apmMentioned =
    /\b(?:application(?:\s+performance)?\s+monitoring|apm(?:\s+insight)?|business-critical\s+applications?|applications?\s+(?:that\s+are\s+)?business-critical)\b/i.test(
      text,
    );
  if (apmMentioned) {
    const apmMatch = text.match(
      /\b(?:application(?:\s+performance)?\s+monitoring|apm(?:\s+insight)?|business-critical\s+applications?|applications?\s+(?:that\s+are\s+)?business-critical|few\s+applications\s+that\s+are\s+business-critical)\b/i,
    );
    fields.push({
      key: "application_monitoring",
      label: "Application Performance Monitoring (APM)",
      group: "applications",
      value: "Business-critical application monitoring requested",
      unit: "applications",
      state: "provided",
      confidence: 0.9,
      evidence: apmMatch ? apmMatch[0].trim() : "application monitoring",
      conflictWith: null,
      previousValue: null,
      materialToPricing: false,
    });
  }

  // 5. RUM Pageviews
  let rumPageviews: number | null = null;
  let rumEvidence: string | null = null;
  let rumState: IntakeUnitState = "unknown";

  const rumMentioned = /\b(?:rum|real\s+user\s+monitoring|pageviews?)\b/i.test(text);

  const rumMillionMatch =
    text.match(
      /(\d+(?:[.,]\d+)?)\s*(?:million\b|m\b)\s*(?:[a-z\s/]{0,25}?)\b(?:pageviews?|views?|rum)\b/i,
    ) ||
    text.match(
      /(?:rum|real\s+user\s+monitoring)\s*(?:[a-z\s]{0,25}?)\b(\d+(?:[.,]\d+)?)\s*(?:million\b|m\b)\s*(?:pageviews?|views?)?/i,
    );
  const rumKMatch = text.match(
    /(\d+(?:[.,]\d+)?)\s*(?:thousand\b|k\b)\s*(?:[a-z\s/]{0,25}?)\b(?:pageviews?|views?|rum)\b/i,
  );
  const rumColonMatch = text.match(
    /(?:rum|real\s+user\s+monitoring|pageviews?)[^:\n\r\d]{0,50}[:=]\s*(\d[\d,.]*)\s*(million|m|k|thousand)?/i,
  );
  const rumRawMatch = text.match(
    /(\d{1,3}(?:,\d{3})+|\d{5,})\s*(?:[a-z\s/]{0,25}?)\b(?:pageviews?|views?|rum)\b/i,
  );

  const rumNone =
    serversOnly ||
    (noOtherNeeds && !rumMentioned) ||
    /\b(?:no\s+rum|zero\s+rum|0\s+rum|don'?t\s+need\s+rum|rum\s*:\s*(?:none|0|no)|no\s+real\s+user\s+monitoring)\b/i.test(
      lower,
    );

  if (rumNone) {
    rumPageviews = 0;
    rumState = "none";
    rumEvidence = serversOnly ? "Excluded via servers-only rule" : "Explicitly stated no RUM pageviews";
    fields.push({
      key: "rum_pageviews",
      label: "RUM Pageviews",
      group: "applications",
      value: 0,
      unit: "pageviews/month",
      state: "provided",
      intakeState: "none",
      confidence: 0.99,
      evidence: rumEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (rumMillionMatch && rumMillionMatch[1]) {
    rumPageviews = Math.round(parseFloat(rumMillionMatch[1].replace(/,/g, "")) * 1_000_000);
    rumState = "stated";
    rumEvidence = rumMillionMatch[0].trim();
    fields.push({
      key: "rum_pageviews",
      label: "RUM Pageviews",
      group: "applications",
      value: rumPageviews,
      unit: "pageviews/month",
      state: "provided",
      intakeState: "stated",
      confidence: 0.95,
      evidence: rumEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (rumKMatch && rumKMatch[1]) {
    rumPageviews = Math.round(parseFloat(rumKMatch[1].replace(/,/g, "")) * 1_000);
    rumState = "stated";
    rumEvidence = rumKMatch[0].trim();
    fields.push({
      key: "rum_pageviews",
      label: "RUM Pageviews",
      group: "applications",
      value: rumPageviews,
      unit: "pageviews/month",
      state: "provided",
      intakeState: "stated",
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
    rumState = "stated";
    rumEvidence = rumColonMatch[0].trim();
    fields.push({
      key: "rum_pageviews",
      label: "RUM Pageviews",
      group: "applications",
      value: rumPageviews,
      unit: "pageviews/month",
      state: "provided",
      intakeState: "stated",
      confidence: 0.95,
      evidence: rumEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (rumRawMatch && rumRawMatch[1]) {
    rumPageviews = parseInt(rumRawMatch[1].replace(/,/g, ""), 10);
    rumState = "stated";
    rumEvidence = rumRawMatch[0].trim();
    fields.push({
      key: "rum_pageviews",
      label: "RUM Pageviews",
      group: "applications",
      value: rumPageviews,
      unit: "pageviews/month",
      state: "provided",
      intakeState: "stated",
      confidence: 0.95,
      evidence: rumEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (rumMentioned) {
    rumState = "unknown";
    missingMaterialFields.push("rum_pageviews");
    fields.push({
      key: "rum_pageviews",
      label: "RUM Pageviews",
      group: "applications",
      value: null,
      unit: "pageviews/month",
      state: "missing",
      intakeState: "unknown",
      confidence: null,
      evidence: null,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  }

  // 6. AppLogs Volume (per month or GB/day)
  let applogGb: number | null = null;
  let applogEvidence: string | null = null;
  let applogState: IntakeUnitState = "unknown";

  const logMentioned =
    (/\b(?:applogs?|log\s+management)\b/i.test(text) || /\b(?:logs?)\b/i.test(text)) &&
    !/logistics|login|dialog|catalog/i.test(text);

  const logDayMatch = text.match(
    /(\d+)\s*(?:gb|gigabytes?)\s*(?:\/|\s+per\s+)\s*day\b/i,
  );
  const logMatch =
    text.match(
      /(\d+)\s*(?:gb|gigabytes?|tb|terabytes?)\s*(?:[a-z\s/]{0,20}?)\b(?:applogs?|logs?)\b/i,
    ) ||
    text.match(
      /(?:applogs?|logs?|log\s+management)[^:\n\r\d]{0,50}[:=]\s*(\d+)\s*(?:gb|gigabytes?|tb|terabytes?)?/i,
    ) ||
    text.match(
      /(?:applogs?|logs?)\s*(?:volume|storage|size|retention)?\s*(?:of|:|=)?\s*(\d+)\s*(?:gb|gigabytes?|tb|terabytes?)/i,
    );

  const logNone =
    serversOnly ||
    (noOtherNeeds && !logMentioned) ||
    /\b(?:no\s+logs?|zero\s+logs?|0\s+logs?|don'?t\s+need\s+logs?|logs?\s*:\s*(?:none|0|no)|no\s+applogs?)\b/i.test(
      lower,
    );

  if (logNone) {
    applogGb = 0;
    applogState = "none";
    applogEvidence = serversOnly ? "Excluded via servers-only rule" : "Explicitly stated no logs needed";
    fields.push({
      key: "applogs_volume",
      label: "AppLogs Volume",
      group: "applications",
      value: 0,
      unit: "GB/month",
      state: "provided",
      intakeState: "none",
      confidence: 0.99,
      evidence: applogEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (logDayMatch && logDayMatch[1]) {
    // GB/day converted to monthly volume (30 days)
    applogGb = parseInt(logDayMatch[1], 10) * 30;
    applogState = "stated";
    applogEvidence = logDayMatch[0].trim();
    fields.push({
      key: "applogs_volume",
      label: "AppLogs Volume",
      group: "applications",
      value: applogGb,
      unit: "GB/month",
      state: "provided",
      intakeState: "stated",
      confidence: 0.95,
      evidence: `${applogEvidence} (converted to 30-day monthly volume)`,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (logMatch && logMatch[1]) {
    const isTb = logMatch[0].toLowerCase().includes("tb") || logMatch[0].toLowerCase().includes("terabyte");
    applogGb = parseInt(logMatch[1], 10) * (isTb ? 1024 : 1);
    applogState = "stated";
    applogEvidence = logMatch[0].trim();
    fields.push({
      key: "applogs_volume",
      label: "AppLogs Volume",
      group: "applications",
      value: applogGb,
      unit: "GB/month",
      state: "provided",
      intakeState: "stated",
      confidence: 0.95,
      evidence: applogEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (logMentioned) {
    applogState = "unknown";
    missingMaterialFields.push("applogs_volume");
    fields.push({
      key: "applogs_volume",
      label: "AppLogs Volume",
      group: "applications",
      value: null,
      unit: "GB/month",
      state: "missing",
      intakeState: "unknown",
      confidence: null,
      evidence: null,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  }

  // Compound multi-specification check: if buyer explicitly specifies multiple items (e.g. servers + websites + synthetic)
  // or says "no other needs", any remaining unmentioned units among the 6 become "none".
  const compoundSpecification =
    noOtherNeeds ||
    /\+/.test(text) ||
    (serverCount !== null && basicCount !== null && advancedCount !== null && serverCount > 0 && basicCount > 0 && advancedCount > 0);

  if (compoundSpecification) {
    if (networkState === "unknown" && !netMentioned) {
      networkState = "none";
      networkCount = 0;
    }
    if (rumState === "unknown" && !rumMentioned) {
      rumState = "none";
      rumPageviews = 0;
    }
    if (applogState === "unknown" && !logMentioned) {
      applogState = "none";
      applogGb = 0;
    }
  }

  // Build the 6 Intake Requirements
  const intakeRequirements: Record<IntakeUnit, IntakeRequirement> = {
    host_monitor: {
      unit: "host_monitor",
      state: serverState,
      quantity: serverCount,
      evidence: serverEvidence,
    },
    basic_monitor: {
      unit: "basic_monitor",
      state: basicState,
      quantity: basicCount,
      evidence: basicEvidence,
    },
    advanced_monitor: {
      unit: "advanced_monitor",
      state: advancedState,
      quantity: advancedCount,
      evidence: advancedEvidence,
    },
    network_component: {
      unit: "network_component",
      state: networkState,
      quantity: networkCount,
      evidence: networkEvidence,
    },
    rum_pageview: {
      unit: "rum_pageview",
      state: rumState,
      quantity: rumPageviews,
      evidence: rumEvidence,
    },
    applog_gb: {
      unit: "applog_gb",
      state: applogState,
      quantity: applogGb,
      evidence: applogEvidence,
    },
  };

  // Optional Grouped Parameters (does not block sufficiency)
  const optionalParameters: OptionalRequirementParameters = {};

  const usersMatch =
    text.match(/(\d+)\s*(?:users?|team\s+members?|logins?)\b/i) ||
    text.match(/(?:users?|team\s+size)[^:\n\r\d]{0,30}[:=]\s*(\d+)/i) ||
    text.match(/\b(?:team\s+of\s+(\d+)|more\s+than\s+10\s+users)\b/i);

  if (usersMatch) {
    const uCount = usersMatch[1] ? parseInt(usersMatch[1], 10) : 11;
    optionalParameters.usersOver10 = uCount > 10;
  }

  const retentionMatch =
    text.match(/(\d+)\s*(?:days?|months?)\s*(?:log\s+)?retention\b/i) ||
    text.match(/(?:retention)[^:\n\r\d]{0,30}[:=]\s*(\d+)\s*(?:days?|months?)?/i);

  if (retentionMatch && retentionMatch[1]) {
    const rawVal = parseInt(retentionMatch[1], 10);
    const isMonths = retentionMatch[0].toLowerCase().includes("month");
    const totalDays = isMonths ? rawVal * 30 : rawVal;
    optionalParameters.logRetentionOver30Days = totalDays > 30;
  }

  if (/\b(?:status\s+pages?|public\s+status)\b/i.test(lower)) {
    optionalParameters.statusPages = true;
  }

  if (/\b(?:anomaly\s+detection|ai\s+alerts?|smart\s+anomal(?:y|ies))\b/i.test(lower)) {
    optionalParameters.anomalyDetection = true;
  }

  // 7. Commercial Metadata: Billing Period
  let billingPeriod: BillingPeriod = "annual";
  const billingMatch = text.match(
    /(?:billing|billed|payment|contract|subscription)[^:\n\r]{0,30}[:=]\s*(annual(?:ly)?|yearly|monthly)/i,
  );
  if (billingMatch && billingMatch[1]) {
    billingPeriod = /annual|yearly/i.test(billingMatch[1]) ? "annual" : "monthly";
  } else if (/\b(?:annually|annual\s+billing|yearly\s+billing|annual\s+subscription)\b/i.test(lower)) {
    billingPeriod = "annual";
  } else if (/\b(?:month-to-month|monthly\s+billing|billed\s+monthly|monthly\s+subscription)\b/i.test(lower)) {
    billingPeriod = "monthly";
  } else if (lower.includes("annual")) {
    billingPeriod = "annual";
  } else if (
    lower.includes("monthly") &&
    !lower.includes("monthly pageview") &&
    !lower.includes("monthly applog") &&
    !lower.includes("monthly rum")
  ) {
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

  // 8. Commercial Metadata: Currency
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
  } else if (
    input.senderEmail.includes("@") &&
    !input.senderEmail.endsWith("@gmail.com") &&
    !input.senderEmail.endsWith("@yahoo.com")
  ) {
    const domainPart = input.senderEmail.split("@")[1]?.split(".")[0];
    if (domainPart) {
      organization = domainPart.charAt(0).toUpperCase() + domainPart.slice(1);
    }
  }

  // --- Sufficiency & Gap Evaluation ---
  const isComplete = isSufficientToQuote(intakeRequirements);

  const unknownUnits = INTAKE_UNITS.filter(
    (unit) => intakeRequirements[unit].state === "unknown",
  );

  let suggestedQuestion: ClarificationQuestion | null = null;
  if (!isComplete && unknownUnits.length > 0) {
    const questions = buildClarificationQuestions(unknownUnits);
    suggestedQuestion = {
      id: `cq_${Date.now()}`,
      fieldKeys: unknownUnits.map((u) => UNIT_TO_FIELD_KEY[u]),
      question: questions.join("\n"),
      reason: `Clarification needed for unknown intake units: ${unknownUnits.join(", ")}.`,
      askedAt: new Date().toISOString(),
      answeredAt: null,
      answerSummary: null,
    };
  }

  const demand: PricingDemand = {
    ...emptyDemand(),
    host_monitor: serverCount ?? 0,
    network_component: networkCount ?? 0,
    advanced_monitor: advancedCount ?? 0,
    basic_monitor: basicCount ?? 0,
    rum_pageview: rumPageviews ?? 0,
    applog_gb: applogGb ?? 0,
  };

  const summary = isComplete
    ? `Sufficient requirements captured: ${serverCount ?? 0} servers, ${basicCount ?? 0} basic monitors, ${advancedCount ?? 0} advanced monitors, ${networkCount ?? 0} network devices, ${rumPageviews ?? 0} RUM, ${applogGb ?? 0}GB logs.`
    : `Inquiry requires clarification for ${unknownUnits.length} unknown parameter(s): ${unknownUnits.join(", ")}.`;

  const profile: RequirementProfile = {
    id: `prof_${Date.now()}`,
    threadId: input.threadId,
    version: 1,
    supersedesProfileId: null,
    createdAt: new Date().toISOString(),
    extractorModel: "quote24x7-extractor-v2.0.0",
    extractorRunId: `run_${Date.now()}`,
    fields,
    summary,
    pendingQuestions: suggestedQuestion ? [suggestedQuestion] : [],
    answeredQuestions: [],
    clarificationRound: suggestedQuestion ? 1 : 0,
    intakeRequirements,
    optionalParameters,
    triageCategory,
  };

  return {
    profile,
    demand,
    isComplete,
    missingMaterialFields: unknownUnits.map((u) => UNIT_TO_FIELD_KEY[u]),
    suggestedQuestion,
    organization,
    billingPeriod,
    currency,
    triageCategory,
    isSubstantive: triageCategory !== "non_substantive",
    intakeRequirements,
    optionalParameters,
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
 * evaluates sufficiency, and updates answered questions.
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

  const mergedIntake: Record<IntakeUnit, IntakeRequirement> = {
    host_monitor: { ...existingProfile.intakeRequirements?.host_monitor ?? { unit: "host_monitor", state: "unknown", quantity: null, evidence: null } },
    basic_monitor: { ...existingProfile.intakeRequirements?.basic_monitor ?? { unit: "basic_monitor", state: "unknown", quantity: null, evidence: null } },
    advanced_monitor: { ...existingProfile.intakeRequirements?.advanced_monitor ?? { unit: "advanced_monitor", state: "unknown", quantity: null, evidence: null } },
    network_component: { ...existingProfile.intakeRequirements?.network_component ?? { unit: "network_component", state: "unknown", quantity: null, evidence: null } },
    rum_pageview: { ...existingProfile.intakeRequirements?.rum_pageview ?? { unit: "rum_pageview", state: "unknown", quantity: null, evidence: null } },
    applog_gb: { ...existingProfile.intakeRequirements?.applog_gb ?? { unit: "applog_gb", state: "unknown", quantity: null, evidence: null } },
  };

  // Check if reply answers a pending question directly with a standalone number
  const pendingUnits = INTAKE_UNITS.filter((u) => mergedIntake[u].state === "unknown");
  const fallbackNumberMatch = replyText.match(
    /(?:need|have|want|use|about|around)?\s*(\d+)\s*(?:monitors?|endpoints?|checks?|servers?|hosts?|devices?|views?|pageviews?|gb)?/i,
  );

  if (pendingUnits.length === 1 && fallbackNumberMatch && fallbackNumberMatch[1]) {
    const targetUnit = pendingUnits[0]!;
    if (replyExtraction.intakeRequirements[targetUnit].state === "unknown") {
      const val = parseInt(fallbackNumberMatch[1], 10);
      mergedIntake[targetUnit] = {
        unit: targetUnit,
        state: "stated",
        quantity: val,
        evidence: fallbackNumberMatch[0].trim(),
      };
    }
  }

  // Merge each unit from reply
  for (const unit of INTAKE_UNITS) {
    const fromReply = replyExtraction.intakeRequirements[unit];
    if (fromReply && (fromReply.state === "stated" || fromReply.state === "none")) {
      mergedIntake[unit] = { ...fromReply };
    }
  }

  // Merge fields
  const mergedFields: RequirementField[] = [];
  for (const unit of INTAKE_UNITS) {
    const meta = UNIT_TO_FIELD_KEY[unit];
    const intake = mergedIntake[unit];
    const existingField = existingProfile.fields.find((f) => f.key === meta);

    if (intake.state === "stated") {
      mergedFields.push({
        key: meta,
        label: existingField?.label || meta,
        group: existingField?.group || "infrastructure",
        value: intake.quantity,
        unit: existingField?.unit || null,
        state: "provided",
        intakeState: "stated",
        confidence: 0.98,
        evidence: intake.evidence,
        conflictWith: null,
        previousValue: existingField && existingField.value !== intake.quantity ? existingField.value : existingField?.previousValue ?? null,
        materialToPricing: true,
      });
    } else if (intake.state === "none") {
      mergedFields.push({
        key: meta,
        label: existingField?.label || meta,
        group: existingField?.group || "infrastructure",
        value: 0,
        unit: existingField?.unit || null,
        state: "provided",
        intakeState: "none",
        confidence: 0.99,
        evidence: intake.evidence || "Excluded from scope",
        conflictWith: null,
        previousValue: existingField && existingField.value !== 0 ? existingField.value : existingField?.previousValue ?? null,
        materialToPricing: true,
      });
    } else {
      mergedFields.push({
        key: meta,
        label: existingField?.label || meta,
        group: existingField?.group || "infrastructure",
        value: null,
        unit: existingField?.unit || null,
        state: "missing",
        intakeState: "unknown",
        confidence: null,
        evidence: null,
        conflictWith: null,
        previousValue: null,
        materialToPricing: true,
      });
    }
  }

  // Carry forward non-quantity fields
  for (const f of existingProfile.fields) {
    if (!INTAKE_UNITS.map((u) => UNIT_TO_FIELD_KEY[u]).includes(f.key) && !mergedFields.some((mf) => mf.key === f.key)) {
      mergedFields.push(f);
    }
  }
  for (const f of replyExtraction.profile.fields) {
    if (!INTAKE_UNITS.map((u) => UNIT_TO_FIELD_KEY[u]).includes(f.key) && !mergedFields.some((mf) => mf.key === f.key)) {
      mergedFields.push(f);
    }
  }

  // Check newly answered questions
  const newlyAnsweredQuestions: ClarificationQuestion[] = [];
  const remainingPendingQuestions: ClarificationQuestion[] = [];

  for (const question of existingProfile.pendingQuestions) {
    const allAnswered = question.fieldKeys.every((key) => {
      const f = mergedFields.find((field) => field.key === key);
      return f && (f.intakeState === "stated" || f.intakeState === "none");
    });

    if (allAnswered) {
      newlyAnsweredQuestions.push({
        ...question,
        answeredAt: new Date().toISOString(),
        answerSummary: `Resolved from buyer reply: ${question.fieldKeys.map((k) => `${k}: ${mergedFields.find((f) => f.key === k)?.value ?? "none"}`).join(", ")}`,
      });
    } else {
      remainingPendingQuestions.push(question);
    }
  }

  // Sufficiency check
  const isComplete = isSufficientToQuote(mergedIntake);
  const remainingUnknowns = INTAKE_UNITS.filter((u) => mergedIntake[u].state === "unknown");

  let suggestedQuestion: ClarificationQuestion | null = null;
  if (!isComplete && remainingUnknowns.length > 0) {
    const questions = buildClarificationQuestions(remainingUnknowns);
    suggestedQuestion = {
      id: `cq_${Date.now()}`,
      fieldKeys: remainingUnknowns.map((u) => UNIT_TO_FIELD_KEY[u]),
      question: questions.join("\n"),
      reason: `Remaining missing parameters: ${remainingUnknowns.join(", ")}.`,
      askedAt: new Date().toISOString(),
      answeredAt: null,
      answerSummary: null,
    };
    remainingPendingQuestions.push(suggestedQuestion);
  }

  const demand: PricingDemand = {
    ...emptyDemand(),
    host_monitor: mergedIntake.host_monitor.quantity ?? 0,
    basic_monitor: mergedIntake.basic_monitor.quantity ?? 0,
    advanced_monitor: mergedIntake.advanced_monitor.quantity ?? 0,
    network_component: mergedIntake.network_component.quantity ?? 0,
    rum_pageview: mergedIntake.rum_pageview.quantity ?? 0,
    applog_gb: mergedIntake.applog_gb.quantity ?? 0,
  };

  const summary = isComplete
    ? `Sufficient requirements captured across turns: ${demand.host_monitor} servers, ${demand.basic_monitor} basic monitors, ${demand.advanced_monitor} advanced monitors, ${demand.network_component} network devices, ${demand.rum_pageview} RUM, ${demand.applog_gb}GB logs.`
    : `Inquiry partially clarified (round ${existingProfile.clarificationRound + 1}); still missing: ${remainingUnknowns.join(", ")}.`;

  const profile: RequirementProfile = {
    id: `prof_${Date.now()}`,
    threadId: existingProfile.threadId,
    version: existingProfile.version + 1,
    supersedesProfileId: existingProfile.id,
    createdAt: new Date().toISOString(),
    extractorModel: "quote24x7-extractor-v2.0.0",
    extractorRunId: `run_${Date.now()}`,
    fields: mergedFields,
    summary,
    pendingQuestions: remainingPendingQuestions,
    answeredQuestions: [...existingProfile.answeredQuestions, ...newlyAnsweredQuestions],
    clarificationRound: existingProfile.clarificationRound + 1,
    intakeRequirements: mergedIntake,
    optionalParameters: {
      ...existingProfile.optionalParameters,
      ...replyExtraction.optionalParameters,
    },
    triageCategory: replyExtraction.triageCategory,
  };

  const isSubstantive = isSubstantiveEmail(replyText, existingProfile);

  return {
    profile,
    demand,
    isComplete,
    missingMaterialFields: remainingUnknowns.map((u) => UNIT_TO_FIELD_KEY[u]),
    suggestedQuestion,
    organization: replyExtraction.organization || existingProfile.fields.find((f) => f.key === "organization")?.value as string || null,
    billingPeriod: replyExtraction.billingPeriod,
    currency: replyExtraction.currency,
    triageCategory: replyExtraction.triageCategory,
    isSubstantive,
    intakeRequirements: mergedIntake,
    optionalParameters: profile.optionalParameters || {},
  };
}
