# Quote24x7

> Salesman-style quotation assistant for Site24x7 India monitoring solutions.

Quote24x7 answers customer inquiries, asks for missing requirements, and when requirements are sufficient, replies with a priced breakdown plus a PDF quotation.

All prices are integer paise sourced directly from Site24x7 India pricing and Zoho Store rate cards. The system does not invent, estimate, interpolate, or divide prices. Code decides when to ask questions and when to quote; the language model never computes prices or decides workflow state.

---

## Capabilities

- **Inbound Email Processing**: Ingests emails via Resend webhooks with Svix signature verification, RFC threading (`Message-ID`, `In-Reply-To`, `References`), and replay deduplication.
- **Loop Prevention & Triage**: Filters auto-replies, postmaster notices, bounces, and bulk mailing lists. Blocks outbound dispatch to internal and Zoho domains.
- **Requirement Extraction & Clarification**: Tracks 6 monitoring units (hosts, basic monitors, advanced monitors, network components, RUM pageviews, AppLogs). When details are missing, asks at most 3 targeted questions per round (capped at 3 rounds).
- **Deterministic Pricing Engine**: Knapsack calculation across candidate plans (Lite, Starter, Web Performance, Professional, Classic, Enterprise, MSP). Line items compute as base plan list rate plus plan-specific add-on packs from Zoho Store.
- **PDF Generation**: Generates vector A4 estimate documents using `pdf-lib` with itemized line items, included allowances, transparent Zoho Store add-on references, and official Zoho quote terms.
- **Console**: Split-pane interface providing thread views with inbound/outbound message histories, delivery statuses, what was understood (stated/assumed/missing), open questions, quote versions, and operator Send/Edit/Hold controls.

---

## Tech Stack

- **Framework**: Next.js 15 (App Router), React 19, TypeScript
- **Database**: Supabase PostgreSQL with Row Level Security (RLS)
- **PDF Generation**: `pdf-lib`
- **Email Infrastructure**: Resend SDK, Svix Webhook Verification
- **Test Runner**: Native Node.js test runner (`node --test`)

---

## Getting Started

### 1. Installation

```bash
git clone https://github.com/JoanathanPS/Quote24x7.git
cd Quote24x7/apps/web
npm install
```

### 2. Environment Variables

Create `.env.local` based on `.env.example`:

```bash
cp .env.example .env.local
```

Required environment variables:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=ey...
RESEND_API_KEY=re_...
RESEND_WEBHOOK_SECRET=whsec_...
OUTBOUND_FROM_EMAIL="Quote24x7 <quotes@quotes.yourdomain.com>"
ALLOW_EXTERNAL_DISPATCH=false
GEMINI_API_KEY=...
```

### 3. Database Setup & Migrations

Quote24x7 uses Supabase as its runtime store for catalogue data, threads, messages, requirements, quotes, deliveries, webhook events, and knowledge.

```bash
# 1. Log in to Supabase CLI
npx supabase login

# 2. Link repository to your Supabase project
npx supabase link --project-ref your-project-ref

# 3. Apply schema migrations
npx supabase db push
```

> **Security Note:** All runtime tables enforce Row Level Security (RLS) with no policies for `anon` or `authenticated` roles. Backend access requires `SUPABASE_SERVICE_ROLE_KEY`.

### 4. Running Locally

```bash
# Start Next.js development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the console.

---

## Quality & Testing

```bash
# Run catalogue build, linter, typescript check, and test suite
npm run check

# Run unit and integration tests only
npm test
```

---

## License

MIT License. Quote24x7 is an independent assistant based on Site24x7 public pricing and is not affiliated with Zoho Corporation.
