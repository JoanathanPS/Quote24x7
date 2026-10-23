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

export const UNIT_KEYWORDS: Record<IntakeUnit, string[]> = {
  host_monitor: ["server", "servers", "host", "hosts", "vm", "vms", "node", "nodes", "machine", "machines", "instance", "instances", "server count", "blade", "blades", "bare-metal", "ec2", "branch server", "branch servers", "compute node", "compute nodes"],
  basic_monitor: ["website", "websites", "url", "urls", "endpoint", "endpoints", "api", "apis", "uptime", "website check", "website checks", "web check", "web checks", "uptime check", "uptime checks", "basic monitor", "basic monitors", "web portal", "web portals", "web console", "web consoles", "web application", "web applications", "web dashboard", "web dashboards", "web page", "web pages", "storefront", "storefronts", "alb endpoint", "alb endpoints", "ingress", "ingress service", "ingress services", "portal url", "portal urls"],
  network_component: ["network", "switch", "switches", "router", "routers", "firewall", "firewalls", "network device", "network devices", "network component", "network components", "network gear", "gateway", "gateways", "vpc gateway", "vpc gateways", "sd-wan router", "sd-wan routers", "cloud router", "cloud routers", "top-of-rack switch", "top-of-rack switches", "tor switch", "tor switches", "core switch", "core switches", "industrial switch", "industrial switches", "plant switch", "plant switches"],
  advanced_monitor: ["synthetic", "synthetics", "synthetic check", "synthetic checks", "browser transaction", "browser transactions", "advanced monitor", "advanced monitors", "journey", "journeys", "critical web", "synthetic monitor", "synthetic monitors", "synthetic transaction", "synthetic transactions", "real browser", "browser synthetic", "user flow", "user flows", "billing journey", "billing journeys", "java app", "java apps", "apm", "apm instance", "apm instances"],
  rum_pageview: ["rum", "real user", "pageview", "pageviews", "page view", "page views"],
  applog_gb: ["log", "logs", "applog", "applogs", "gb/day", "gb per day", "log ingestion", "log management", "log aggregation", "retention", "gb/mo", "gb per month", "gb monthly", "logs monthly", "tb", "terabytes"],
};

export interface ExtractionInput {
  threadId: string;
  senderEmail: string;
  senderName?: string | null;
  subject: string;
  bodyText: string;
  headers?: Record<string, string> | null;
  previousProfile?: RequirementProfile | null;
}

export interface ExtractionResult {
  profile: RequirementProfile;
  demand: PricingDemand;
  isComplete: boolean;
  missingMaterialFields: string[];
  suggestedQuestion: ClarificationQuestion | null;
  clarificationQuestions: string[];
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
  headers?: Record<string, string> | null,
): EmailTriageCategory {
  const combined = `${subject}\n${bodyText}\n${_from || ""}`.toLowerCase();
  const cleanBody = bodyText.trim().toLowerCase();

  // 1. Automated mail / bounces / system notices
  const autoHdr = headers ? (headers["auto-submitted"] || headers["Auto-Submitted"]) : null;
  if (autoHdr && autoHdr.toLowerCase() !== "no") {
    return "ignored_automated";
  }
  const isBounceOrAuto =
    /\b(?:out\s+of\s+(?:the\s+)?office|auto-?reply|automatic\s+reply|mailer-daemon|delivery\s+status\s+notification|undelivered\s+mail|failure\s+notice|dmarc|report\s+domain|noreply|no-reply|postmaster|newsletter)\b/i.test(
      combined,
    ) ||
    /\[##\d+##\]/.test(combined);

  if (isBounceOrAuto) {
    return "ignored_automated";
  }

  // 2. Unsupported: reseller request, RFP attachment, non-India market, feature request
  const isReseller =
    /\b(?:reseller|partner\s+discount|partner\s+margin|white-?label|partner\s+program|become\s+a\s+partner|distributor|deal\s+registration)\b/i.test(
      combined,
    );
  const isNonIndia =
    /\b(?:u\.s\.\s+pricing|usa\s+pricing|us\s+dollars?|dollar\s+pricing|usd\s+pricing|in\s+dollars|eur|€|quote\s+in\s+eur|gbp|£|outside\s+india|non-india|united\s+states\s+pricing)\b/i.test(
      combined,
    ) && !/\binr|rupee|₹\b/i.test(combined);
  const isFeatureRequest =
    /\b(?:feature\s+request|can\s+you\s+build\s+feature|custom\s+feature\s+development|need\s+a\s+custom\s+feature|please\s+add\s+support\s+for)\b/i.test(
      combined,
    );
  const isRfpTender =
    /\b(?:rfp\s+tender|formal\s+bidding|tender\s+doc(?:ument)?|bid\s+submission)\b/i.test(
      combined,
    );

  if (isReseller || isNonIndia || isFeatureRequest || isRfpTender) {
    return "unsupported";
  }

  // 3. Casual pleasantries / acknowledgement
  const isShortPleasantry =
    /^(?:hi|hello|hey|greetings|thanks(?:\s+for\s+(?:the\s+)?(?:email|update|reply|info|information|response))?|thank\s+you(?:\s+for\s+(?:the\s+)?(?:email|update|reply|info|information|response))?|thx|ok|okay|k|noted|received|acknowledged|cool|sure|got\s+it|sounds\s+good|ok\s+sounds\s+good|all\s+good|fine)[.!]?$/i.test(
      cleanBody,
    ) ||
    (cleanBody.length < 50 &&
      /^(?:(?:hi|hello|thanks|thank\s+you|ok|okay|sure|cool|got\s+it|noted|sounds\s+good|for\s+the\s+email|for\s+the\s+update)[,\s.!]*)+$/i.test(
        cleanBody,
      ));

  if (isShortPleasantry) {
    return "casual_acknowledgement";
  }

  // 4. Other non-substantive: unsubscribe, vendor solicitations
  const isUnsubscribe = /\b(?:unsubscribe|stop\s+emails|opt-?out)\b/i.test(combined);
  const isVendorSolicitation =
    /\b(?:seo\s+services?|guest\s+post|hire\s+(?:offshore|remote)\s+developers?|lead\s+generation\s+services?|software\s+development\s+agency)\b/i.test(
      combined,
    );

  if (isUnsubscribe || isVendorSolicitation) {
    return "non_substantive";
  }

  // 5. Actionable RFQ: has at least one monitoring need mentioned
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

  // 6. Vague inquiry: broad interest with no quantities or specifics
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
export function buildClarificationQuestions(unknownUnits: IntakeUnit[], isFollowup = false): string[] {
  if (unknownUnits.length === 0) return [];

  if (isFollowup) {
    const unitNames = unknownUnits.map((u) => {
      if (u === "host_monitor") return "server count";
      if (u === "network_component") return "network device count";
      if (u === "basic_monitor") return "website or API endpoint count";
      if (u === "advanced_monitor") return "synthetic transaction requirements";
      if (u === "rum_pageview") return "estimated RUM pageview volume";
      if (u === "applog_gb") return "monthly log ingestion volume";
      return u;
    });
    return [
      `I still need your ${unitNames.join(" and ")} to complete the sizing.`,
    ];
  }

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
    /^(?:hi|hello|hey|greetings|thanks(?:\s+for\s+(?:the\s+)?(?:email|update|reply|info|information|response))?|thank\s+you(?:\s+for\s+(?:the\s+)?(?:email|update|reply|info|information|response))?|thx|ok|okay|k|noted|received|acknowledged|cool|sure|got\s+it|sounds\s+good)[.!]?$/i.test(
      lower,
    ) ||
    lower.length < 35
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
 * Masks hardware and OS model numbers (e.g. Catalyst 9300, FortiGate 100F,
 * Windows Server 2022, Ubuntu 22.04, c5.2xlarge, m5.xlarge) so their model
 * numbers are never parsed as quantities.
 */
export function maskModelTokens(text: string): string {
  return text
    .replace(/\bCatalyst\s+\d+\b/gi, "Catalyst_SWITCH")
    .replace(/\bFortiGate\s+\d+[a-zA-Z]*\b/gi, "FortiGate_FIREWALL")
    .replace(/\b(?:Windows\s+Server|Windows)\s+\d+\b/gi, "Windows_Server_OS")
    .replace(/\bUbuntu\s+\d+(?:\.\d+)?\b/gi, "Ubuntu_OS")
    .replace(/\b[cmr]\d+\.[a-zA-Z0-9]+\b/gi, "CLOUD_INSTANCE")
    .replace(/\b(?:c5|m5|r5|t3|t4g)\.[a-zA-Z0-9]+\b/gi, "CLOUD_INSTANCE")
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d+\b/gi, "CIDR_BLOCK")
    .replace(/\b(?:port|ports)\s+\d+\b/gi, "PORT_NUMBER")
    .replace(/\b\d+\s*-\s*ports?\b/gi, "PATCH_PANEL_PORTS")
    .replace(/\b(?:listening\s+on\s+|runs?\s+on\s+|on\s+)?port\s+\d+\b/gi, "PORT_NUMBER")
    .replace(/\bapi\s+keys?\b/gi, "API_KEY_TOKEN")
    .replace(/\b\d+\s*(?:employees?|staff|people|workers)\b/gi, "EMPLOYEE_COUNT")
    .replace(/\b(?:5G|4G|3G|2G)\b/gi, "CELLULAR_GEN")
    .replace(/\bCase-\d+-[a-zA-Z0-9_.-]+\b/gi, "CASE_FILENAME_TOKEN")
    .replace(/\[Attached\s+[a-zA-Z0-9 ]+:\s*"[^"]*"/gi, "")
    .replace(/\b(?:ticket|case|issue|ref)\s*#?\s*\d+\b/gi, "TICKET_NUMBER")
    .replace(/\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/gi, "PHONE_NUMBER")
    .replace(/\b\d{10,12}\b/gi, "PHONE_NUMBER")
    .replace(/\b(?:charged\s+(?:us\s+)?|costs?|paying|rate|price|fee|budget\s*(?:of|is|:)?)\s*(?:[$€£₹]|\b(?:rs\.?|inr|usd)\b)?\s*\d[\d,.]*(?:\s*(?:per|\/)\s*[a-z]+)*/gi, "PRICE_TOKEN")
    .replace(/(?:[$€£₹]|\b(?:rs\.?|inr|usd)\s*)\d[\d,.]*(?:\s*(?:per|\/)\s*[a-z]+)*/gi, "PRICE_TOKEN")
    .replace(/\b\d[\d,.]*\s*(?:per|\/)\s*(?:server|host|device|switch|router|vm|month|year|annum|hr|hour|day|user|seat|gb|tb)\b(?:\s*(?:per|\/)\s*[a-z]+)*/gi, "PRICE_TOKEN");
}

const TENS_WORDS = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
const ONES_WORDS = "one|two|three|four|five|six|seven|eight|nine";
const TEENS_WORDS = "ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen";
const ALL_NUM_WORDS = `${TENS_WORDS}|${ONES_WORDS}|${TEENS_WORDS}|hundred|thousand|million`;
export const WORD_NUMBER_REGEX_PART = `(?:(?:${TENS_WORDS})[\\s-]+(?:${ONES_WORDS})|${ALL_NUM_WORDS}|(?:[a-z]+(?:\\s+[a-z]+){1,4}))`;

export function parseWordNumber(str: string): number | null {
  const clean = str.toLowerCase().trim().replace(/-/g, " ");
  const words = clean.split(/\s+/);
  let total = 0;
  let current = 0;

  const small: Record<string, number> = {
    zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
    eighty: 80, ninety: 90,
  };

  for (const w of words) {
    if (w === "and") continue;
    if (small[w] !== undefined) {
      current += small[w];
    } else if (w === "hundred") {
      current = (current === 0 ? 1 : current) * 100;
    } else if (w === "thousand") {
      total += (current === 0 ? 1 : current) * 1000;
      current = 0;
    } else if (w === "million") {
      total += (current === 0 ? 1 : current) * 1000000;
      current = 0;
    } else {
      return null;
    }
  }
  const result = total + current;
  return result > 0 ? result : null;
}

function extractCombinedEvidence(rawText: string, matches: RegExpMatchArray[]): string {
  if (matches.length === 0) return "";
  const first = matches[0]?.[0]?.trim() ?? "";
  if (matches.length === 1) return first;
  const last = matches[matches.length - 1]?.[0]?.trim() ?? "";
  const lower = rawText.toLowerCase();
  const idx1 = lower.indexOf(first.toLowerCase());
  const idx2 = lower.lastIndexOf(last.toLowerCase());
  if (idx1 !== -1 && idx2 !== -1 && idx2 >= idx1) {
    const end = idx2 + last.length;
    if (end - idx1 <= 150) {
      return rawText.slice(idx1, end).trim();
    }
  }
  return first;
}

/**
 * Robust requirement extractor for Site24x7 monitoring inquiries.
 * Tracks the 6 billable intake units in state: stated, none, or unknown.
 */
export function extractRequirements(input: ExtractionInput): ExtractionResult {
  if (input.previousProfile) {
    return mergeRequirements({
      existingProfile: input.previousProfile,
      replyText: input.bodyText,
      senderEmail: input.senderEmail,
      senderName: input.senderName,
      subject: input.subject,
    });
  }

  const rawText = input.bodyText;
  const docMarker = "\n\n[Attached Documents]:\n";
  const hasDocAttachment = rawText.includes(docMarker);
  const inboundRawText = hasDocAttachment ? rawText.split(docMarker)[0]! : rawText;
  const inboundText = maskModelTokens(inboundRawText);
  const fullText = maskModelTokens(rawText);
  const scanText = hasDocAttachment && !/\d/.test(inboundText) ? fullText : inboundText;
  const text = scanText;
  const lower = text.toLowerCase();

  const triageBody = hasDocAttachment ? input.bodyText.split(docMarker)[0]! : input.bodyText;
  const triageCategory = triageInboundEmail(input.subject, triageBody, input.senderEmail, input.headers);
  const fields: RequirementField[] = [];
  let missingMaterialFields: string[] = [];

  // Global "just servers" / "only servers" check
  const serversOnlyMatch = rawText.match(
    /\b(?:only\s+(?:need\s+)?servers?|just\s+servers?|servers?\s+only|solely\s+servers?|strictly\s+servers?|all\s+we\s+need\s+is\s+servers?)\b/i,
  );
  const serversOnly = Boolean(serversOnlyMatch);

  // Global "no other needs" check
  const noOtherNeedsMatch = rawText.match(
    /\b(?:no\s+other\s+(?:monitoring|needs?|requirements?|checks?|services?)|nothing\s+else|no\s+others?|nothing\s+else\s+needed|no\s+other\s+monitoring\s+needed|no\s+other\s+checks?|no\s+other\s+services?)\b/i,
  );
  const noOtherNeeds = Boolean(noOtherNeedsMatch);
  const scopeClosureMatch = rawText.match(/\b(?:that\s+is\s+(?:all|everything)|that['’]s\s+(?:all|everything)|nothing\s+else|only\s+(?:those|these|the\s+above))\b/i);
  const scopeClosed = noOtherNeeds || Boolean(scopeClosureMatch);

  // Collect all negated clauses in text across all 6 units
  const negatedUnitMap = new Map<IntakeUnit, string>();
  const negPatterns = [
    /\b(?:do\s+not|don'?t|not)\s+(?:need|require|want|look\s+for|use)\s+([^.!\n;]+)/gi,
    /\b(?:not\s+interested\s+in|no\s+interest\s+in)\s+([^.!\n;]+)/gi,
    /\b(?:no\s+need\s+for)\s+([^.!\n;]+)/gi,
    /\b(?:no|without|zero|0)\s+([^.!\n;]+?)(?:\s+(?:needed|required|necessary|wanted|to\s+monitor))?(?:[.!\n;]|$)/gi,
    /\b(?:exclude|excluding|skip|dropping|remove|removed)\s+([^.!\n;]+)/gi,
  ];

  for (const pat of negPatterns) {
    for (const match of text.matchAll(pat)) {
      const rawPhrase = match[1] ? match[1].toLowerCase() : "";
      const phrase = rawPhrase.replace(/\b(?:outside|except|other\s+than|besides)\b.*/i, "").trim();
      const ev = match[0].trim();
      if (/\b(?:servers?|hosts?|vms?|virtual\s+machines?|instances?|nodes?|blades?|bare-metal)\b/i.test(phrase)) {
        if (!negatedUnitMap.has("host_monitor")) negatedUnitMap.set("host_monitor", ev);
      }
      if (/\b(?:network(?:\s+(?:devices?|components?|gear))?|switches?|routers?|firewalls?|gateways?)\b/i.test(phrase)) {
        if (!negatedUnitMap.has("network_component")) negatedUnitMap.set("network_component", ev);
      }
      if (/\b(?:websites?|web\s+sites?|urls?|endpoints?|apis?|basic(?:\s+monitors?)?|uptime(?:\s+checks?)?|web\s+checks?)\b/i.test(phrase)) {
        if (!negatedUnitMap.has("basic_monitor")) negatedUnitMap.set("basic_monitor", ev);
      }
      if (/\b(?:synthetics?|browser(?:\s+transactions?)?|advanced(?:\s+monitors?)?|user\s+journeys?|journeys?)\b/i.test(phrase)) {
        if (!negatedUnitMap.has("advanced_monitor")) negatedUnitMap.set("advanced_monitor", ev);
      }
      if (/\b(?:rum|real\s+user(?:\s+monitoring)?|page\s*views?|traffic)\b/i.test(phrase)) {
        if (!negatedUnitMap.has("rum_pageview")) negatedUnitMap.set("rum_pageview", ev);
      }
      if (/\b(?:logs?|applogs?|log\s+monitoring|log\s+management|log\s+collection|log\s+aggregation)\b/i.test(phrase)) {
        if (!negatedUnitMap.has("applog_gb")) negatedUnitMap.set("applog_gb", ev);
      }
    }
  }

  // Compound negation check: "no synthetic checks or RUM needed", "without servers or network", etc.
  const compoundNegMatch = text.match(/\b(?:no|without)\s+([a-z\s,/-]+?)\s+(?:needed|required|necessary|wanted)\b/i);
  const compoundNegPhrase = compoundNegMatch ? compoundNegMatch[0].trim() : null;
  const compoundNegInner = compoundNegMatch && compoundNegMatch[1] ? compoundNegMatch[1].toLowerCase() : "";

  const generalCloserEvidence = noOtherNeedsMatch
    ? noOtherNeedsMatch[0].trim()
    : scopeClosureMatch
      ? scopeClosureMatch[0].trim()
    : serversOnlyMatch
      ? serversOnlyMatch[0].trim()
      : null;

  // 1. Servers / Host Monitors
  let serverCount: number | null = null;
  let serverEvidence: string | null = null;
  let serverState: IntakeUnitState = "unknown";

  const authoritativeHostMatch =
    inboundRawText.match(/Total\s+(?:Host\s+Server|Host|Server)\s+Requirement\s*[:=]\s*(\d+)/i) ||
    inboundRawText.match(/Total\s+Requirement\s*[:=]\s*(\d+)\s*(?:Host|Server)/i);

  const serverChangeMatch =
    text.match(/(?:reduce|lower|increase|change|adjust)\s*(?:the\s+)?(?:servers?|hosts?|vms?)\s*(?:from\s+\d+\s+)?to\s*(\d+)/i) ||
    text.match(/(\d+)\s*(?:servers?|hosts?|vms?)?\s*instead\s+of\s*(\d+)/i) ||
    text.match(/(?:make\s+(?:it|that)|should\s+be)\s+(\d+)\s*(?:servers?|hosts?|vms?)/i);

  const inlineServerMatches = [
    ...text.matchAll(
      /(?<![a-zA-Z0-9])(\d+)[^\S\r\n]*(?:(?!(?:servers?|hosts?|vms?|instances?|nodes?|machines?|blades?|websites?|urls?|endpoints?|routers?|switches?|firewalls?|checks?)\b)[a-zA-Z0-9_-]+[^\S\r\n]*){0,6}\b(servers?|hosts?|vms?|instances?|nodes?|machines?|blades?|bare-metal(?:\s+blades?)?|ec2(?:\s+instances?)?|branch\s+servers?|compute\s+nodes?)\b/gi,
    ),
  ].filter(
    (m) =>
      !m[0].toLowerCase().includes("per ") &&
      !m[0].toLowerCase().includes("instead of") &&
      !m[0].toLowerCase().includes("reduce to") &&
      !m[0].toLowerCase().includes("change to"),
  );
  let inlineHostSum = 0;
  if (!authoritativeHostMatch && !serverChangeMatch && inlineServerMatches.length > 1) {
    inlineHostSum = inlineServerMatches.reduce((acc, m) => acc + parseInt(m[1]!, 10), 0);
  }

  const itemLineServerMatches = [...text.matchAll(/(?:^|\n)[^\S\r\n]*[•\-\*]?\s*(\d+)\s+([^\n\r]*?\b(?:Linux|Windows|Ubuntu|Database|Active\s+Directory|Hosts?|Servers?|Nodes?|VMs?|Blades?|EC2)\b[^\n\r]*)/gi)];
  let itemLineHostSum = 0;
  if (!authoritativeHostMatch && itemLineServerMatches.length > 1) {
    for (const m of itemLineServerMatches) {
      itemLineHostSum += parseInt(m[1]!, 10);
    }
  }

  const serverNoneMatch = text.match(
    /\b(?:no\s+(?:servers?|vms?|hosts?|nodes?|instances?|blades?)|without\s+(?:servers?|vms?|hosts?|nodes?|instances?|blades?)|zero\s+servers?|0\s+servers?|don'?t\s+need\s+servers?|servers?\s*:\s*(?:none|0|no)|no\s+vms?|without\s+vms?)\b/i,
  );
  const serverNotInterestedMatch = inboundText.match(/\bnot\s+interested\s+in\b[^.!?\n;]*\bservers?\b/i);
  const serverMentioned =
    /\b(?:servers?|hosts?|vms?|instances?|nodes?|machines?|blades?|bare-metal|ec2|branch\s+servers?|compute\s+nodes?)\b/i.test(text);

  const serverMatch =
    text.match(
      /(?<![a-zA-Z0-9])(\d+)[^\S\r\n]*(?:(?!(?:servers?|hosts?|vms?|instances?|nodes?|machines?|blades?|websites?|urls?|endpoints?|routers?|switches?|firewalls?|checks?)\b)[a-zA-Z0-9_-]+[^\S\r\n]*){0,6}\b(?:servers?|hosts?|vms?|instances?|nodes?|machines?|blades?|bare-metal(?:\s+blades?)?|ec2(?:\s+instances?)?|branch\s+servers?|compute\s+nodes?)\b/i,
    ) ||
    text.match(
      /(?:servers?|hosts?|vms?|instances?|nodes?|machines?|blades?)[^:\n\r\d,|]{0,50}[:=,|\t]\s*"?(\d+)"?/i,
    ) ||
    text.match(
      /(?:servers?|hosts?|nodes?|instances?)\s*(?:count|total|:|=|,|\||\t)\s*"?(\d+)"?/i,
    );

  const wordServerMatch = text.match(
    new RegExp(`\\b(${WORD_NUMBER_REGEX_PART})\\s*(?:production\\s+|prod\\s+|linux\\s+|windows\\s+|database\\s+|app\\s+|application\\s+|web\\s+|virtual\\s+|cloud\\s+|bare-metal\\s+)?\\b(servers?|hosts?|vms?|instances?|nodes?|machines?|blades?)\\b`, "i"),
  );

  const hasPositiveHost = Boolean(authoritativeHostMatch || serverChangeMatch || inlineHostSum > 0 || itemLineHostSum > 0 || (serverMatch && serverMatch[1]) || (wordServerMatch && wordServerMatch[1]));
  const serverNone =
    (!hasPositiveHost && scopeClosed && !serverMentioned) ||
    Boolean(serverNoneMatch) ||
    Boolean(serverNotInterestedMatch) ||
    Boolean(compoundNegPhrase && /\b(?:servers?|hosts?|vms?|instances?|machines?|blades?)\b/i.test(compoundNegInner)) ||
    (!hasPositiveHost && negatedUnitMap.has("host_monitor"));

  if (serverNone) {
    serverCount = 0;
    serverState = "none";
    serverEvidence = serverNoneMatch ? serverNoneMatch[0].trim() : serverNotInterestedMatch ? serverNotInterestedMatch[0].trim() : negatedUnitMap.get("host_monitor") ?? compoundNegPhrase ?? generalCloserEvidence ?? (serverMatch ? serverMatch[0].trim() : "servers");
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
  } else if (authoritativeHostMatch && authoritativeHostMatch[1]) {
    serverCount = parseInt(authoritativeHostMatch[1], 10);
    serverState = "stated";
    serverEvidence = authoritativeHostMatch[0].trim();
    fields.push({
      key: "servers",
      label: "Server / Host Monitors",
      group: "infrastructure",
      value: serverCount,
      unit: "servers",
      state: "provided",
      intakeState: "stated",
      confidence: 0.99,
      evidence: serverEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (serverChangeMatch && serverChangeMatch[1]) {
    serverCount = parseInt(serverChangeMatch[1], 10);
    serverState = "stated";
    serverEvidence = serverChangeMatch[0].trim();
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
  } else if (itemLineHostSum > 0) {
    serverCount = itemLineHostSum;
    serverState = "stated";
    serverEvidence = itemLineServerMatches[0]![0].trim();
    fields.push({
      key: "servers",
      label: "Server / Host Monitors",
      group: "infrastructure",
      value: serverCount,
      unit: "servers",
      state: "provided",
      intakeState: "stated",
      confidence: 0.95,
      evidence: serverEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (inlineHostSum > 0) {
    serverCount = inlineHostSum;
    serverState = "stated";
    serverEvidence = extractCombinedEvidence(rawText, inlineServerMatches);
    fields.push({
      key: "servers",
      label: "Server / Host Monitors",
      group: "infrastructure",
      value: serverCount,
      unit: "servers",
      state: "provided",
      intakeState: "stated",
      confidence: 0.95,
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
  } else if (wordServerMatch && wordServerMatch[1] && parseWordNumber(wordServerMatch[1]) !== null) {
    serverCount = parseWordNumber(wordServerMatch[1])!;
    serverState = "stated";
    serverEvidence = wordServerMatch[0].trim();
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

  const authoritativeNetMatch =
    rawText.match(/Total\s+Network\s+(?:Component|Device)\s+Requirement\s*[:=]\s*(\d+)/i) ||
    rawText.match(/Total\s+(?:Network\s+)?Component\s+Requirement\s*[:=]\s*(\d+)/i);

  const netChangeMatch =
    text.match(/(?:reduce|lower|increase|change|adjust)\s*(?:the\s+)?(?:network|switches?|devices?|routers?|firewalls?|gateways?)\s*(?:from\s+\d+\s+)?to\s*(\d+)/i) ||
    text.match(/(\d+)\s*(?:network\s+devices?|switches?|routers?|firewalls?|gateways?)?\s*instead\s+of\s*(\d+)/i) ||
    text.match(/(?:make\s+(?:it|that)|should\s+be)\s+(\d+)\s*(?:network\s+devices?|switches?|routers?|firewalls?|gateways?)/i);

  const inlineNetMatches = [
    ...text.matchAll(
      /(?<![a-zA-Z0-9])(\d+)\s*(?:[a-z\s]{0,25}?)\b(switches?|routers?|firewalls?|gateways?|vpc\s+gateways?|sd-wan\s+routers?|cloud\s+routers?|top-of-rack\s+switches?|tor\s+switches?|network\s+(?:devices?|components?|gear)?)\b/gi,
    ),
  ].filter(
    (m) =>
      !m[0].toLowerCase().includes("per ") &&
      !m[0].toLowerCase().includes("instead of") &&
      !m[0].toLowerCase().includes("and ") &&
      !m[0].toLowerCase().includes("servers") &&
      !m[0].toLowerCase().includes("hosts") &&
      !m[0].toLowerCase().includes("instances") &&
      !m[0].toLowerCase().includes("nodes"),
  );
  let inlineNetSum = 0;
  if (!authoritativeNetMatch && !netChangeMatch && inlineNetMatches.length > 1) {
    inlineNetSum = inlineNetMatches.reduce((acc, m) => acc + parseInt(m[1]!, 10), 0);
  }

  const itemLineNetMatches = [...text.matchAll(/(?:^|\n)[^\S\r\n]*[•\-\*]?\s*(\d+)\s+([^\n\r]*?\b(?:Catalyst|FortiGate|Switches?|Routers?|Firewalls?|Gateways?|Network\s+Devices?)\b[^\n\r]*)/gi)];
  let itemLineNetSum = 0;
  if (!authoritativeNetMatch && itemLineNetMatches.length > 1) {
    for (const m of itemLineNetMatches) {
      itemLineNetSum += parseInt(m[1]!, 10);
    }
  }

  const netMentioned =
    /\b(?:network(?:\s+(?:devices?|switches?|routers?|components?|firewalls?|gateways?))?|switches?|routers?|firewalls?|gateways?|cloud\s+routers?|sd-wan\s+routers?|vpc\s+gateways?)\b/i.test(
      text,
    );

  const netMatch =
    text.match(
      /(?<![a-zA-Z0-9])(\d+)[^\S\r\n]*(?:[a-z \t]{0,30}?)\b(?:network(?:\s+devices?)?|switches?|routers?|firewalls?|gateways?|vpc\s+gateways?|sd-wan\s+routers?|cloud\s+routers?|top-of-rack\s+switches?)\b(?!\s*(?:servers?|hosts?|vms?|nodes?|instances?|machines?))/i,
    ) ||
    text.match(
      /(?:network(?:\s+devices?)?|switches?|routers?|firewalls?|gateways?)[^:\n\r\d,|]{0,50}[:=\t|]\s*"?(\d+)"?/i,
    ) ||
    text.match(
      /(?:network(?:\s+devices?)?|switches?|routers?|gateways?)\s*(?:count|total|:|=|,|\||\t)\s*"?(\d+)"?/i,
    );

  const wordNetMatch = text.match(
    new RegExp(`\\b(${WORD_NUMBER_REGEX_PART})\\s*(?:network\\s+|core\\s+|access\\s+|cisco\\s+)?\\b(switches?|routers?|firewalls?|gateways?|network(?:\\s+devices?)?)\\b`, "i"),
  );

  const netNoneMatch = text.match(
    /\b(?:no\s+network(?:\s+(?:devices?|switches?|routers?|components?|firewalls?|interfaces?|gear|gateways?))?|without\s+network(?:\s+(?:devices?|switches?|routers?|components?|firewalls?|interfaces?|gear|gateways?))?|zero\s+network|0\s+network|don'?t\s+need\s+network|network\s*:\s*(?:none|0|no)|no\s+(?:switches|routers|firewalls|gateways)|without\s+(?:switches|routers|firewalls|gateways)|remove\s+(?:all\s+)?network(?:\s+devices?)?)\b/i,
  );

  const hasPositiveNet = Boolean(authoritativeNetMatch || netChangeMatch || inlineNetSum > 0 || itemLineNetSum > 0 || (netMatch && netMatch[1]) || (wordNetMatch && wordNetMatch[1]));

  const netNone =
    serversOnly ||
    (!hasPositiveNet && scopeClosed && !netMentioned) ||
    Boolean(netNoneMatch) ||
    /\bno\s+[^.!?\n;]{0,80}\b(?:network|switches?|routers?|firewalls?|gateways?)\b/i.test(inboundText) ||
    Boolean(compoundNegPhrase && /\b(?:network(?:\s+devices?)?|switches?|routers?|firewalls?|gateways?)\b/i.test(compoundNegInner)) ||
    (!hasPositiveNet && negatedUnitMap.has("network_component"));

  if (netNone) {
    networkCount = 0;
    networkState = "none";
    networkEvidence = netNoneMatch ? netNoneMatch[0].trim() : negatedUnitMap.get("network_component") ?? compoundNegPhrase ?? generalCloserEvidence ?? (netMatch ? netMatch[0].trim() : "network");
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
  } else if (authoritativeNetMatch && authoritativeNetMatch[1]) {
    networkCount = parseInt(authoritativeNetMatch[1], 10);
    networkState = "stated";
    networkEvidence = authoritativeNetMatch[0].trim();
    fields.push({
      key: "network_devices",
      label: "Network Devices",
      group: "infrastructure",
      value: networkCount,
      unit: "devices",
      state: "provided",
      intakeState: "stated",
      confidence: 0.99,
      evidence: networkEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (netChangeMatch && netChangeMatch[1]) {
    networkCount = parseInt(netChangeMatch[1], 10);
    networkState = "stated";
    networkEvidence = netChangeMatch[0].trim();
    fields.push({
      key: "network_devices",
      label: "Network Devices",
      group: "infrastructure",
      value: networkCount,
      unit: "devices",
      state: "provided",
      intakeState: "stated",
      confidence: 0.98,
      evidence: networkEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (itemLineNetSum > 0) {
    networkCount = itemLineNetSum;
    networkState = "stated";
    networkEvidence = itemLineNetMatches[0]![0].trim();
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
  } else if (inlineNetSum > 0) {
    networkCount = inlineNetSum;
    networkState = "stated";
    networkEvidence = extractCombinedEvidence(rawText, inlineNetMatches);
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
  } else if (wordNetMatch && wordNetMatch[1] && parseWordNumber(wordNetMatch[1]) !== null) {
    networkCount = parseWordNumber(wordNetMatch[1])!;
    networkState = "stated";
    networkEvidence = wordNetMatch[0].trim();
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

  const isServerLine = (line: string): boolean =>
    /\b(?:servers?|hosts?|vms?|nodes?|instances?|ubuntu|linux|windows|c5\.|m5\.|database\s+&\s+active\s+directory)\b/i.test(line);

  const isSectionHeading = (line: string): boolean =>
    /^\s*\d+\.\s+[A-Za-z]/i.test(line.trim());

  let basicCountCandidate: { quantity: number; evidence: string } | null = null;

  const websiteChangeMatch =
    text.match(/(?:the\s+)?(?:\d+\s+)?(?:websites?|urls?)\s+should\s+be\s+(\d+)/i) ||
    text.match(/(?:make\s+(?:it|that)|change\s+to|update\s+to)\s+(\d+)\s*(?:websites?|urls?)/i) ||
    text.match(/(\d+)\s*(?:websites?|urls?)?\s*instead\s+of\s*(\d+)/i);

  if (websiteChangeMatch && websiteChangeMatch[1]) {
    basicCountCandidate = {
      quantity: parseInt(websiteChangeMatch[1], 10),
      evidence: websiteChangeMatch[0].trim(),
    };
  }

  const itemLineBasicMatches = [
    ...text.matchAll(/(?:^|\n)[^\S\r\n]*[•\-\*]?\s*(\d+)[^\S\r\n]*([^\n\r]*?\b(?:basic(?:\s+monitors?)?|ping(?:\s+monitors?)?|port(?:\s+monitors?)?|standard(?:\s+monitors?)?|websites?|urls?|web\s+sites?|apis?|api\s+endpoints?|rest\s+apis?|web\s+endpoints?|endpoints?|website(?:\s+uptime|\s+availability)?(?:\s+monitors?|\s+checks?)?)\b[^\n\r]*)/gi),
  ];
  if (!basicCountCandidate) {
    for (const m of itemLineBasicMatches) {
      if (!isServerLine(m[0]) && !isSectionHeading(m[0])) {
        basicCountCandidate = {
          quantity: parseInt(m[1]!, 10),
          evidence: m[0].trim(),
        };
        break;
      }
    }
  }

  if (!basicCountCandidate) {
    const inlineBasicMatches = [
      ...text.matchAll(
        /(?<![a-zA-Z0-9])(\d+)\s*(?:(?:public|external|internal|secure|monitored|active|news|web)\s+){0,2}\b(websites?|urls?|portal\s+urls?|web\s+portals?|portals?|web\s+sites?|api\s+endpoints?|rest\s+apis?|web\s+endpoints?|alb\s+endpoints?|endpoints?|ingress(?:\s+services?)?|web\s+checks?|website\s+checks?|website\s+monitors?|web\s+consoles?|consoles?|web\s+applications?|web\s+dashboards?|dashboards?|internal\s+web\s+pages?|web\s+pages?|public\s+storefronts?|storefronts?|basic(?:\s+monitors?)?|ping(?:\s+monitors?)?|port(?:\s+monitors?|\s+checks?)?|uptime(?:\s+monitors?|\s+checks?)?|tcp\s+port\s+checks?)\b/gi,
      ),
    ].filter((m) => {
      const raw = m[0].toLowerCase();
      if (raw.includes("pageview") || raw.includes("rum") || raw.includes("million") || raw.includes("log") || raw.includes("tb") || raw.includes("gb")) return false;
      return true;
    });

    if (inlineBasicMatches.length > 1) {
      const sum = inlineBasicMatches.reduce((acc, m) => acc + parseInt(m[1]!, 10), 0);
      basicCountCandidate = {
        quantity: sum,
        evidence: extractCombinedEvidence(rawText, inlineBasicMatches),
      };
    } else if (inlineBasicMatches.length === 1) {
      basicCountCandidate = {
        quantity: parseInt(inlineBasicMatches[0]![1]!, 10),
        evidence: inlineBasicMatches[0]![0].trim(),
      };
    }
  }

  if (!basicCountCandidate) {
    const mColon = text.match(/(?:basic|ping|port|website\s+uptime|uptime\s+checks?|websites?|urls?|apis?|endpoints?)[^:\n\r\d,|]{0,50}[:=\t|,]\s*"?(\d+)"?/i);
    if (mColon && mColon[1] && !isServerLine(mColon[0])) {
      basicCountCandidate = {
        quantity: parseInt(mColon[1], 10),
        evidence: mColon[0].trim(),
      };
    }
  }

  if (!basicCountCandidate) {
    const wordBasicMatch = text.match(
      new RegExp(`\\b(${WORD_NUMBER_REGEX_PART})\\s*(?:public\\s+|external\\s+|internal\\s+|secure\\s+|monitored\\s+|active\\s+|news\\s+)?\\b(websites?|urls?|portal\\s+urls?|web\\s+portals?|portals?|web\\s+sites?|api\\s+endpoints?|rest\\s+apis?|web\\s+endpoints?|alb\\s+endpoints?|endpoints?|ingress(?:\\s+services?)?|web\\s+checks?|website\\s+checks?|web\s+consoles?|consoles?|web\\s+applications?|web\\s+dashboards?|dashboards?|internal\\s+web\\s+pages?|web\\s+pages?|public\\s+storefronts?|storefronts?|basic(?:\\s+monitors?)?|uptime\\s+checks?|website\\s+checks?|tcp\\s+port\\s+checks?)\\b`, "i"),
    );
    if (wordBasicMatch && wordBasicMatch[1] && parseWordNumber(wordBasicMatch[1]) !== null) {
      basicCountCandidate = {
        quantity: parseWordNumber(wordBasicMatch[1])!,
        evidence: wordBasicMatch[0].trim(),
      };
    }
  }

  const websiteAvailabilityMentioned =
    /\b(?:website(?:\s+is|\s+being)?\s+accessible|website\s+uptime|website\s+downtime|website\s+(?:going\s+)?down|website\s+availability|website\s+accessibility|check\s+(?:our\s+)?website|monitor(?:\s+whether)?\s+(?:our\s+)?website)\b/i.test(
      text,
    ) || /\b(?:monitor(?:ing)?\s+(?:our\s+)?website)\b/i.test(text);

  const basicMentioned =
    /\b(?:basic|ping|port|standard)\s*monitors?\b/i.test(text) ||
    /\b(?:websites?|urls?|web\s+urls?|endpoints?|web\s+portals?|web\s+consoles?|web\s+applications?|web\s+dashboards?|web\s+checks?|web\s+pages?|storefronts?|alb\s+endpoints?|ingress)\b/i.test(text) ||
    /\b(?:api\s+endpoints?|rest\s+apis?|public\s+apis?|monitored\s+apis?|check\s+apis?|monitor\s+apis?)\b/i.test(text) ||
    websiteAvailabilityMentioned;

  const basicNoneMatch = text.match(
    /\b(?:no\s+(?:websites?|urls?|apis?|endpoints?|basic(?:\s+monitors?)?|uptime\s+checks?|website\s+checks?|web\s+checks?|web\s+portals?|web\s+consoles?|web\s+applications?)|without\s+(?:websites?|urls?|apis?|endpoints?|basic(?:\s+monitors?)?|uptime\s+checks?|website\s+checks?|web\s+checks?|web\s+portals?|web\s+consoles?|web\s+applications?)|zero\s+(?:websites?|urls?|apis?)|0\s+(?:websites?|urls?|apis?)|don'?t\s+need\s+(?:websites?|urls?|apis?)|(?:websites?|urls?|apis?)\s*:\s*(?:none|0|no)|no\s+basic\s+website\s+checks)\b/i,
  );

  const hasPositiveBasic = basicCountCandidate !== null;

  const basicNone =
    serversOnly ||
    (!hasPositiveBasic && scopeClosed && !/\bwebsite\s+(?:is\s+)?accessible\b/i.test(text)) ||
    Boolean(basicNoneMatch) ||
    Boolean(compoundNegPhrase && /\b(?:websites?|urls?|apis?|endpoints?|basic\s+monitors?|uptime\s+checks?|website\s+checks?|web\s+checks?|web\s+portals?|web\s+consoles?|web\s+applications?)\b/i.test(compoundNegInner)) ||
    (!hasPositiveBasic && negatedUnitMap.has("basic_monitor"));

  if (hasPositiveBasic && !basicNoneMatch) {
    basicCount = basicCountCandidate!.quantity;
    basicState = "stated";
    basicEvidence = basicCountCandidate!.evidence;
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
  } else if (basicNone) {
    basicCount = 0;
    basicState = "none";
    basicEvidence = basicNoneMatch ? basicNoneMatch[0].trim() : negatedUnitMap.get("basic_monitor") ?? compoundNegPhrase ?? generalCloserEvidence ?? "websites";
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
  } else if (websiteAvailabilityMentioned) {
    basicCount = 1;
    basicState = "stated";
    const webMatch = text.match(
      /\b(?:website(?:\s+is|\s+being)?\s+accessible|website\s+uptime|website\s+availability|website\s+accessibility|monitor(?:\s+whether)?\s+(?:our\s+)?website)\b/i,
    );
    const siteMatch = rawText.match(/\bwebsites?\b/i);
    basicEvidence = webMatch ? webMatch[0].trim() : (siteMatch ? siteMatch[0].trim() : "website");
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
    /\b(?:synthetic(?:\s+(?:transaction|web|browser))?|advanced(?:\s+web)?|browser[- ]based\s+transaction|real[- ]browser\s+synthetic|critical\s+web)\s*(?:monitors?|monitoring|endpoints?|checks?|urls?|apis?|transactions?|flows?|journeys?)?\b/i.test(
      text,
    ) || /\b(?:synthetic(?:\s+[a-z]+)?\s+monitoring)\b/i.test(text) ||
    /\b(?:apm|java\s+apps?|\.net\s+apps?|node(?:\.js)?\s+apps?|python\s+apps?|application\s+performance\s+monitoring)\b/i.test(text);

  const advMatch =
    text.match(
      /(?<![a-zA-Z0-9])(\d+(?:\s*k|\s*thousand)?)[^\S\r\n]*(?:(?:multi[- ]step|real[- ]browser)\s+){0,2}\b(?:synthetic(?:\s+(?:transaction|web|browser|login))?|advanced(?:\s+web)?|browser[- ]based\s+transaction|critical\s+web)\s*(?:monitors?|endpoints?|urls?|checks?|transactions?|flows?|journeys?)?\b(?!\s*(?:servers?|hosts?|vms?|nodes?|instances?|machines?|logs?))/i,
    ) ||
    text.match(
      /(?:synthetic(?:\s+transaction|\s+web|\s+browser)?|advanced(?:\s+web)?|browser[- ]based\s+transaction)[^:\n\r\d,|]{0,50}[:=\t|,]\s*"?(\d+(?:\s*k|\s*thousand)?)"?/i,
    ) ||
    text.match(
      /(?<![a-zA-Z0-9])(\d+(?:\s*k|\s*thousand)?)[^\S\r\n]*(?:synthetic|advanced|browser[- ]based\s+transaction)\s*(?:(?:transaction|web|browser)\s+)?(?:monitors?|endpoints?|checks?|urls?|apis?|transactions?|flows?|journeys?)/i,
    ) ||
    text.match(
      /(?:advanced|synthetic|browser[- ]based\s+transaction)\s*(?:monitors?|endpoints?|checks?|transactions?|flows?|journeys?)\s*(?:count|total|:|=|\t|\||,)\s*"?(\d+(?:\s*k|\s*thousand)?)"?/i,
    ) ||
    text.match(
      /(?<![a-zA-Z0-9])(\d+(?:\s*k|\s*thousand)?)[^\S\r\n]*(?:(?:java|\.net|node(?:\.js)?|python)\s+(?:apps?|applications?)|apm(?:\s+instances?)?)\b/i,
    ) ||
    text.match(
      /(?:apm|java\s+apps?|\.net\s+apps?|node(?:\.js)?\s+apps?|python\s+apps?)[^:\n\r\d,|]{0,50}[:=\t|]\s*"?(\d+(?:\s*k|\s*thousand)?)"?/i,
    );

  const advNoneMatch = text.match(
    /\b(?:no\s+(?:synthetics?|synthetic(?:\s+(?:checks?|monitors?|transactions?|web|browser))?|advanced(?:\s+monitors?)?|browser\s+transactions?|transactions?)|without\s+(?:synthetics?|synthetic(?:\s+(?:checks?|monitors?|transactions?|web|browser))?|advanced(?:\s+monitors?)?|browser\s+transactions?|transactions?)|zero\s+synthetic|0\s+synthetic|don'?t\s+need\s+synthetic|synthetic\s*:\s*(?:none|0|no)|no\s+advanced\s+monitors?)\b/i,
  );

  const hasPositiveAdv = Boolean(advMatch && advMatch[1]);

  const advNone =
    serversOnly ||
    (!hasPositiveAdv && scopeClosed && !advMentioned) ||
    Boolean(advNoneMatch) ||
    /\bno\s+[^.!?\n;]{0,80}\b(?:synthetic|advanced|transactions?|journeys?)\b/i.test(inboundText) ||
    Boolean(compoundNegPhrase && /\b(?:synthetics?|synthetic|browser\s+transactions?|transactions?)\b/i.test(compoundNegInner)) ||
    (!hasPositiveAdv && negatedUnitMap.has("advanced_monitor"));

  if (hasPositiveAdv && !advNoneMatch) {
    const rawVal = advMatch && advMatch[1] ? advMatch[1].trim().toLowerCase() : "0";
    if (rawVal.endsWith("k") || rawVal.endsWith("thousand")) {
      advancedCount = Math.round(parseFloat(rawVal.replace(/[^\d.]/g, "")) * 1000);
    } else {
      advancedCount = parseInt(rawVal.replace(/[^\d]/g, ""), 10) || 0;
    }
    advancedState = "stated";
    advancedEvidence = advMatch ? advMatch[0].trim() : "synthetic";
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
  } else if (advNone) {
    advancedCount = 0;
    advancedState = "none";
    advancedEvidence = advNoneMatch ? advNoneMatch[0].trim() : negatedUnitMap.get("advanced_monitor") ?? compoundNegPhrase ?? generalCloserEvidence ?? (advMatch ? advMatch[0].trim() : "synthetic");
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
      /(\d+(?:[.,]\d+)?)\s*(?:million\b|m\b)\s*(?:[a-z\s/]{0,35}?)\b(?:pageviews?|views?|rum)\b/i,
    ) ||
    text.match(
      /(?:rum|real\s+user\s+monitoring)\s*(?:[a-z\s]{0,35}?)\b(\d+(?:[.,]\d+)?)\s*(?:million\b|m\b)\s*(?:pageviews?|views?)?/i,
    );
  const rumKMatch = text.match(
    /(\d+(?:[.,]\d+)?)\s*(?:thousand\b|k\b)\s*(?:[a-z\s/]{0,35}?)\b(?:pageviews?|views?|rum)\b/i,
  );
  const rumColonMatch = text.match(
    /(?:rum|real\s+user\s+monitoring|pageviews?)[^:\n\r\d,|]{0,50}[:=\t|,]\s*"?(\d[\d,.]*)"?\s*(million|m|k|thousand)?/i,
  );
  const rumRawMatch =
    text.match(
      /(\d{1,3}(?:,\d{3})+|\d{5,})\s*(?:[a-z\s/()\-]{0,50}?)\b(?:pageviews?|views?|rum)\b/i,
    ) ||
    text.match(
      /(\d{1,3}(?:,\d{3})+|\d{5,})\s+(?:real\s+user\s+monitoring(?:\s*\([a-z]+\))?\s+)?pageviews?/i,
    );

  const wordRumMatch = text.match(
    new RegExp(`\\b(${WORD_NUMBER_REGEX_PART})\\s*(?:million|m|thousand|k)?\\s*(?:pageviews?|views?|rum)\\b`, "i"),
  );
  const simpleWordRumScaleMatch = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(million|thousand)\s+(?:monthly\s+)?(?:pageviews?|views?)\b/i);

  const rumZeroMatch = text.match(
    /(?:rum|real\s+user(?:\s+monitoring)?|pageviews?)[^:\n\r\d,|]{0,50}[:=\t|,]\s*"?0"?\b/i,
  );

  const rumNoneMatch = text.match(
    /\b(?:no\s+(?:rum|real\s+user(?:\s+monitoring)?|page\s*views?|views?)|without\s+(?:rum|real\s+user(?:\s+monitoring)?|page\s*views?|views?)|zero\s+rum|0\s+rum|don'?t\s+need\s+rum|rum\s*:\s*(?:none|0|no)|no\s+real\s+user\s+monitoring)\b/i,
  ) || rumZeroMatch;
  const inboundRumNoneMatch = inboundText.match(
    /\b(?:no\s+(?:rum|real\s+user(?:\s+monitoring)?|page\s*views?|views?)|without\s+(?:rum|real\s+user(?:\s+monitoring)?|page\s*views?|views?)|zero\s+rum|0\s+rum|don'?t\s+need\s+rum|rum\s*:\s*(?:none|0|no)|no\s+real\s+user\s+monitoring|no\s+[^.!?]{0,50}\brum\b)\b/i,
  );

  const hasPositiveRum = Boolean(
    !rumZeroMatch && (rumMillionMatch || rumKMatch || (rumColonMatch?.[1] && parseFloat(rumColonMatch[1].replace(/,/g, "")) > 0) || rumRawMatch || simpleWordRumScaleMatch || (wordRumMatch?.[1] && parseWordNumber(wordRumMatch[1]) !== null))
  );

  const rumNone =
    serversOnly ||
    (!hasPositiveRum && scopeClosed) ||
    Boolean(rumNoneMatch) ||
    Boolean(inboundRumNoneMatch) ||
    /\bno\s+[^.!?\n;]{0,80}\b(?:rum|page\s*views?|real\s+user)\b/i.test(inboundText) ||
    Boolean(compoundNegPhrase && /\b(?:rum|real\s+user|page\s*views?|views?)\b/i.test(compoundNegInner)) ||
    (!hasPositiveRum && negatedUnitMap.has("rum_pageview"));

  if (hasPositiveRum && !rumNoneMatch) {
    if (rumMillionMatch && rumMillionMatch[1]) {
      rumPageviews = Math.round(parseFloat(rumMillionMatch[1].replace(/,/g, "")) * 1_000_000);
      rumEvidence = rumMillionMatch[0].trim();
    } else if (rumKMatch && rumKMatch[1]) {
      rumPageviews = Math.round(parseFloat(rumKMatch[1].replace(/,/g, "")) * 1_000);
      rumEvidence = rumKMatch[0].trim();
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
    } else if (rumRawMatch && rumRawMatch[1]) {
      rumPageviews = parseInt(rumRawMatch[1].replace(/,/g, ""), 10);
      rumEvidence = rumRawMatch[0].trim();
    } else if (simpleWordRumScaleMatch) {
      const base = parseWordNumber(simpleWordRumScaleMatch[1] ?? "") ?? 0;
      rumPageviews = base * ((simpleWordRumScaleMatch[2] ?? "").toLowerCase() === "million" ? 1_000_000 : 1_000);
      rumEvidence = simpleWordRumScaleMatch[0].trim();
    } else if (wordRumMatch && wordRumMatch[1] && parseWordNumber(wordRumMatch[1]) !== null) {
      const wordValue = parseWordNumber(wordRumMatch[1])!;
      const suffix = wordRumMatch[0].toLowerCase();
      rumPageviews = suffix.includes("million") ? wordValue * 1_000_000 : suffix.includes("thousand") ? wordValue * 1_000 : wordValue;
      rumEvidence = wordRumMatch[0].trim();
    }
    rumState = "stated";
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
  } else if (rumNone) {
    rumPageviews = 0;
    rumState = "none";
    rumEvidence = (inboundRumNoneMatch || rumNoneMatch)?.[0]?.trim() ?? negatedUnitMap.get("rum_pageview") ?? compoundNegPhrase ?? generalCloserEvidence ?? (rumRawMatch ? rumRawMatch[0].trim() : "RUM");
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
    /\b(?:applogs?|syslog|syslogs?|log\s+management|log\s+ingestion|log\s+aggregation|log\s+storage|log\s+retention)\b/i.test(text) ||
    /\b\d+\s*(?:gb|gigabytes?|tb|terabytes?)\s*(?:per\s+day|\/day|a\s+day|monthly|per\s+month|\/mo|\/month)?\s*(?:of\s+)?logs?\b/i.test(text) ||
    /\blogs?\b/i.test(text);

  const logMonthlyMatch =
    text.match(/(?:~?\s*(\d[\d,.]*)\s*(?:gb|gigabytes?)\s*(?:monthly|per\s+month|\/mo|\/month))\b/i) ||
    text.match(/(?:monthly(?:\s+ingestion|\s+volume|\s+logs?)?)\s*(?:of|:|=|,|\||\t)?\s*~?\s*(\d[\d,.]*)\s*(?:gb|gigabytes?)\b/i) ||
    text.match(/(?:reduce|lower|increase|change|adjust)\s*(?:log\s+ingestion|logs?|applogs?|log\s+management)[^:\n\r\d,|]{0,50}(?:to|:|=|,|\||\t)\s*(\d[\d,.]*)\s*(?:gb|gigabytes?)/i);

  const logDayMatch = text.match(
    /(\d[\d,.]*)\s*(?:gb|gigabytes?)\s*(?:\/|\s+per\s+|\s+a\s+)\s*day(?:\s*\(x30\))?\b/i,
  );
  const logMatch =
    text.match(/(?:logs?|applogs?)\s*(?:are\s+around|is\s+around|are|is)?\s*(\d+(?:[.,]\d+)?)\s*(tb|terabytes?|gb|gigabytes?)/i) ||
    text.match(
      /(\d[\d,.]*)[^\S\r\n]*(gb|gigabytes?|tb|terabytes?)[^\S\r\n]*(?:[a-z \t/]{0,20}?)\b(?:applogs?|logs?)\b/i,
    ) ||
    text.match(
      /(?:applogs?|logs?|log\s+management)[^:\n\r\d,|]{0,50}[:=\t|,]\s*"?(\d[\d,.]*)"?\s*(?:gb|gigabytes?|tb|terabytes?)?/i,
    ) ||
    text.match(
      /(?:applogs?|logs?)\s*(?:volume|storage|size|retention)?\s*(?:of|:|=|,|\||\t)?\s*"?(\d[\d,.]*)"?\s*(?:gb|gigabytes?|tb|terabytes?)/i,
    );

  const wordLogMatch = text.match(
    new RegExp(`\\b(${WORD_NUMBER_REGEX_PART})\\s*(tb|terabytes?|gb|gigabytes?)(?:\\s+(?:of\\s+)?logs?)?\\b`, "i"),
  );

  const logZeroMatch = text.match(
    /(?:applogs?|logs?|log\s+management)[^:\n\r\d,|]{0,50}[:=\t|,]\s*"?0"?\s*(?:gb|gigabytes?|tb|terabytes?)?\b/i,
  );

  const logNoneMatch = text.match(
    /\b(?:no\s+(?:logs?|applogs?|log\s+management|log\s+ingestion|log\s+aggregation)|without\s+(?:logs?|applogs?|log\s+management|log\s+ingestion|log\s+aggregation)|zero\s+logs?|0\s+logs?|don'?t\s+need\s+logs?|logs?\s*:\s*(?:none|0|no)|no\s+applogs?)\b/i,
  ) || logZeroMatch;

  const hasPositiveLog = Boolean(
    !logZeroMatch && (logMonthlyMatch || logDayMatch || (logMatch?.[1] && parseFloat(logMatch[1].replace(/,/g, "")) > 0) || (wordLogMatch?.[1] && parseWordNumber(wordLogMatch[1]) !== null))
  );

  const logNone =
    serversOnly ||
    (!hasPositiveLog && scopeClosed) ||
    Boolean(logNoneMatch) ||
    /\bno\s+[^.!?\n;]{0,80}\b(?:logs?|applogs?|log\s+management)\b/i.test(inboundText) ||
    Boolean(compoundNegPhrase && /\b(?:logs?|applogs?|log\s+management)\b/i.test(compoundNegInner)) ||
    (!hasPositiveLog && negatedUnitMap.has("applog_gb"));

  if (hasPositiveLog && !logNoneMatch) {
    if (logMonthlyMatch && logMonthlyMatch[1]) {
      applogGb = parseInt(logMonthlyMatch[1].replace(/,/g, ""), 10);
      applogEvidence = logMonthlyMatch[0].trim();
    } else if (logDayMatch && logDayMatch[1]) {
      // GB/day converted to monthly volume (30 days)
      applogGb = parseInt(logDayMatch[1].replace(/,/g, ""), 10) * 30;
      applogEvidence = logDayMatch[0].trim();
    } else if (logMatch && logMatch[1]) {
      let rawVal = parseFloat(logMatch[1].replace(/,/g, ""));
      if (logMatch[0].toLowerCase().includes("tb") || logMatch[0].toLowerCase().includes("terabyte")) {
        rawVal *= 1024;
      }
      applogGb = Math.round(rawVal);
      applogEvidence = logMatch[0].trim();
    } else if (wordLogMatch && wordLogMatch[1] && parseWordNumber(wordLogMatch[1]) !== null) {
      let rawVal = parseWordNumber(wordLogMatch[1])!;
      if ((wordLogMatch[2] ?? "").toLowerCase().includes("tb") || (wordLogMatch[2] ?? "").toLowerCase().includes("terabyte")) {
        rawVal *= 1024;
      }
      applogGb = rawVal;
      applogEvidence = wordLogMatch[0].trim();
    }
    applogState = "stated";
    fields.push({
      key: "applogs_volume",
      label: "AppLogs Volume",
      group: "applications",
      value: applogGb,
      unit: "GB/month",
      state: "provided",
      intakeState: "stated",
      confidence: 0.98,
      evidence: applogEvidence,
      conflictWith: null,
      previousValue: null,
      materialToPricing: true,
    });
  } else if (logNone) {
    applogGb = 0;
    applogState = "none";
    applogEvidence = logNoneMatch ? logNoneMatch[0].trim() : negatedUnitMap.get("applog_gb") ?? compoundNegPhrase ?? generalCloserEvidence ?? (logMatch ? logMatch[0].trim() : "logs");
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
  // or says "no other needs" or has explicit negations, any remaining unmentioned units among the 6 become "none".
  const compoundSpecification =
    noOtherNeeds ||
    Boolean(generalCloserEvidence) ||
    negatedUnitMap.size > 0 ||
    Boolean(compoundNegPhrase) ||
    serversOnly ||
    /\+/.test(text) ||
    (serverCount !== null && basicCount !== null && advancedCount !== null && serverCount > 0 && basicCount > 0 && advancedCount > 0);

  if (compoundSpecification) {
    if (serverState === "unknown" && !serverMentioned && !hasPositiveHost) {
      serverState = "none";
      serverCount = 0;
    }
    if (networkState === "unknown" && !netMentioned) {
      networkState = "none";
      networkCount = 0;
    }
    if (basicState === "unknown" && !basicMentioned) {
      basicState = "none";
      basicCount = 0;
    }
    if (advancedState === "unknown" && !advMentioned) {
      advancedState = "none";
      advancedCount = 0;
    }
    if (rumState === "unknown" && !rumMentioned) {
      rumState = "none";
      rumPageviews = 0;
    }
    if (applogState === "unknown" && !logMentioned) {
      applogState = "none";
      applogGb = 0;
    }

    missingMaterialFields = missingMaterialFields.filter((f) => {
      if (f === "servers" && serverState !== "unknown") return false;
      if (f === "network_devices" && networkState !== "unknown") return false;
      if (f === "basic_monitors" && basicState !== "unknown") return false;
      if (f === "advanced_monitors" && advancedState !== "unknown") return false;
      if (f === "rum_pageviews" && rumState !== "unknown") return false;
      if (f === "applogs_volume" && applogState !== "unknown") return false;
      return true;
    });
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
    rawText,
  };

  const clarificationQuestions =
    !isComplete && unknownUnits.length > 0
      ? buildClarificationQuestions(unknownUnits)
      : [];

  const isSubstantive =
    triageCategory !== "non_substantive" &&
    triageCategory !== "casual_acknowledgement" &&
    triageCategory !== "ignored_automated" &&
    isSubstantiveEmail(input.bodyText);

  const result: ExtractionResult = {
    profile,
    demand,
    isComplete,
    missingMaterialFields,
    suggestedQuestion,
    clarificationQuestions,
    organization,
    billingPeriod,
    currency,
    triageCategory,
    isSubstantive,
    intakeRequirements,
    optionalParameters,
  };

  const integrity = validateEvidenceIntegrity(result, rawText);
  if (!integrity.valid) {
    throw new Error(`Evidence integrity violation: ${integrity.errors.join("; ")}`);
  }

  return result;
}

export interface MergeRequirementsInput {
  existingProfile: RequirementProfile;
  replyText: string;
  senderEmail: string;
  senderName?: string | null;
  subject: string;
  cumulativeText?: string;
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

  // Populate any missing intake units from existingProfile.fields
  for (const field of existingProfile.fields || []) {
    const unit = FIELD_KEY_TO_UNIT[field.key];
    if (unit && mergedIntake[unit].state === "unknown" && field.value !== null && field.value !== undefined) {
      const numVal = typeof field.value === "number" ? field.value : parseInt(String(field.value), 10);
      if (!isNaN(numVal)) {
        mergedIntake[unit] = {
          unit,
          state: numVal === 0 ? "none" : "stated",
          quantity: numVal,
          evidence: field.evidence ?? String(field.value),
        };
      }
    }
  }

  // Merge each unit from reply ONLY if the reply explicitly contains that unit's keyword in its evidence
  // A follow-up that names one unit changes only that unit!
  // Global "no other needs" check in reply: e.g. "no other monitoring needed", "nothing else needed"
  const replyNoOtherNeedsMatch = replyText.match(
    /\b(?:no\s+other\s+(?:monitoring|needs?|requirements?|checks?|services?)|nothing\s+else|no\s+others?)\b/i,
  );
  const replyNoOtherNeeds = Boolean(replyNoOtherNeedsMatch);
  const replyCloserEvidence = replyNoOtherNeedsMatch ? replyNoOtherNeedsMatch[0].trim() : "no other monitoring needed";

  // Merge each unit from reply
  // 1) A follow-up that names a unit updates that unit (needs an evidence span containing that unit's keyword)
  // 2) If reply explicitly says "no other monitoring needed", any unit still unknown becomes "none"
  for (const unit of INTAKE_UNITS) {
    const fromReply = replyExtraction.intakeRequirements[unit];
    if (fromReply && (fromReply.state === "stated" || fromReply.state === "none")) {
      const keywords = UNIT_KEYWORDS[unit];
      const replyLower = replyText.toLowerCase();
      const hasKeywordInReply = keywords.some((k) =>
        new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`, "i").test(replyLower),
      );
      if (
        hasKeywordInReply &&
        fromReply.evidence &&
        keywords.some((k) => new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`, "i").test(fromReply.evidence!.toLowerCase()))
      ) {
        mergedIntake[unit] = { ...fromReply };
      } else if (replyNoOtherNeeds && mergedIntake[unit].state === "unknown") {
        mergedIntake[unit] = {
          unit,
          state: "none",
          quantity: 0,
          evidence: replyCloserEvidence,
        };
      }
    } else if (replyNoOtherNeeds && mergedIntake[unit].state === "unknown") {
      mergedIntake[unit] = {
        unit,
        state: "none",
        quantity: 0,
        evidence: replyCloserEvidence,
      };
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
        evidence: intake.evidence || existingField?.evidence || null,
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
    const questions = buildClarificationQuestions(remainingUnknowns, true);
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
    rawText: `${existingProfile.rawText || ""}\n${input.cumulativeText || ""}\n${existingProfile.fields?.map((f) => f.evidence).filter(Boolean).join("\n") || ""}\n${input.subject}\n${replyText}`,
  };

  const isSubstantive = isSubstantiveEmail(replyText, existingProfile);

  const clarificationQuestions =
    !isComplete && remainingUnknowns.length > 0
      ? buildClarificationQuestions(remainingUnknowns, true)
      : [];

  const result: ExtractionResult = {
    profile,
    demand,
    isComplete,
    missingMaterialFields: remainingUnknowns.map((u) => UNIT_TO_FIELD_KEY[u]),
    suggestedQuestion,
    clarificationQuestions,
    organization: replyExtraction.organization || existingProfile.fields.find((f) => f.key === "organization")?.value as string || null,
    billingPeriod: replyExtraction.billingPeriod,
    currency: replyExtraction.currency,
    triageCategory: replyExtraction.triageCategory,
    isSubstantive,
    intakeRequirements: mergedIntake,
    optionalParameters: profile.optionalParameters || {},
  };

  const integrity = validateEvidenceIntegrity(result, profile.rawText!);
  if (!integrity.valid) {
    throw new Error(`Evidence integrity violation in mergeRequirements: ${integrity.errors.join("; ")}`);
  }

  return result;
}

/**
 * Validates that every extracted requirement's evidence string is a verbatim,
 * case-insensitive substring of the source email and attachment text.
 * Synthetic strings like "no RUM requested" are strictly forbidden.
 */
export function validateEvidenceIntegrity(
  result: ExtractionResult,
  sourceText: string,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const lowerSource = sourceText.toLowerCase();
  const unitFieldKeys = new Set([
    "servers",
    "network_devices",
    "basic_monitors",
    "advanced_monitors",
    "rum_pageviews",
    "applogs_volume",
  ]);

  for (const field of result.profile.fields) {
    if (unitFieldKeys.has(field.key) && field.evidence) {
      const cleanEv = field.evidence.toLowerCase().trim();
      if (!lowerSource.includes(cleanEv)) {
        errors.push(
          `Unit field "${field.key}" has non-verbatim evidence "${field.evidence}" not found in source text.`
        );
      }
    }
  }

  for (const [unit, intake] of Object.entries(result.intakeRequirements)) {
    if (intake.evidence) {
      const cleanEv = intake.evidence.toLowerCase().trim();
      if (!lowerSource.includes(cleanEv)) {
        errors.push(
          `Intake unit "${unit}" has non-verbatim evidence "${intake.evidence}" not found in source text.`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
