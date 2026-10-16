# Quote24x7

> Autonomous email-based AI quotation agent and monitoring configuration assistant for Site24x7.

Quote24x7 understands monitoring requirements from natural language buyer emails, automatically seeks sizing clarifications over email when details are missing, deterministically calculates optimal configurations and add-on capacity packs against verified pricing catalogues, generates professional vector PDF proposals, and dispatches them via Resend.

---

## Key Features

- **Autonomous Email Ingress & Threading**: Inbound email processing via Resend Svix webhooks with automatic multi-turn thread continuation.
- **Fail-Closed Sizing Extraction**: Extracts server hosts, network components, synthetic transaction monitors, RUM pageviews, and AppLogs data.
- **Deterministic AI Pricing Engine**: Integer minor-unit arithmetic with fail-closed integrity checks, headroom estimation, and custom pack calculation.
- **Vector PDF Proposals**: Pixel-accurate PDF quotation generation with itemized component breakdowns and transparent unit rates.
- **Interactive Customer Proposal Portal**: Standalone, responsive customer proposal and purchase handoff page (`/proposals/[id]`).
- **Operational Console**: Split-pane email client inbox with human status tracking (`Needs Reply`, `Configuring`, `Proposal Ready`, `Needs Review`).

---

## Tech Stack

- **Framework**: Next.js 15 (App Router), React 19, TypeScript
- **Styling**: Tailwind CSS, Phosphor Icons
- **State Management**: TanStack React Query, Zustand
- **PDF Generation**: `pdf-lib`
- **Email Infrastructure**: Resend SDK, Svix Webhook Verification
- **Test Suite**: Native Node.js test runner (`node --test`)

---

## Getting Started

### 1. Clone & Install

```bash
git clone https://github.com/JoanathanPS/Quote24x7.git
cd Quote24x7/apps/web
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Configure your credentials:
```env
RESEND_API_KEY=re_...
OUTBOUND_FROM_EMAIL="Quote24x7 <quotes@yourdomain.com>"
RESEND_WEBHOOK_SECRET=whsec_...
ALLOW_EXTERNAL_DISPATCH=true
GEMINI_API_KEY=...
```

### 3. Supabase Database Setup & Migrations

Quote24x7 uses Supabase as its primary persistent runtime database for mail threads, messages, quotations, delivery tracking, knowledge, and pricing catalogues.

```bash
# 1. Authenticate with the Supabase CLI
npx supabase login

# 2. Link your local repository to your remote Supabase project
npx supabase link --project-ref your-project-ref

# 3. Push versioned migrations to your Supabase project
npx supabase db push
```

> **Security Note:** All tables have Row Level Security (RLS) enabled with strictly no policies for `anon` or `authenticated` roles. Backend services authenticate with `SUPABASE_SERVICE_ROLE_KEY`.

### 4. Run Development Server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to open the Quote24x7 console.

---

## Quality & Verification

```bash
# Run lint, typecheck, and test suite in one command
npm run check

# Production build
npm run build
```

---

## License

MIT License. Quote24x7 is an independent pricing assistant and is not an official Zoho Corporation product.
