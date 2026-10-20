# Design System & Visual Language: Quote24x7

## 1. Aesthetic Archetype: Modern High-Density Operations Console
- **Tone & Mood**: Precise, calm, authoritative, high-throughput. Dark-mode first operations cockpit designed for pricing engineers, sales desk managers, and revenue operations analysts.
- **Craft Floor Rules**: Zero decorative gradient text, zero novelty icons, zero cartoonish badge colors. Monospace is strictly reserved for data (currency, IDs, packet counts, timestamps, RFC tokens). Clean single-layer elevation with subtle hairline borders (`border-border/80`).

## 2. Color Palette & Semantic Tokens
- **Background**:
  - `bg-background`: Main container (`hsl(var(--background))`)
  - `bg-surface`: Card and surface elevation (`hsl(var(--surface))`)
  - `bg-surface-sunken`: Secondary recess and header strips (`hsl(var(--surface-sunken))`)
- **Borders**:
  - Hairline borders: `border-border/80` and `border-border/60`
  - Subtle divider rules: `divide-border/60`
- **Text & Hierarchy**:
  - Primary text: `text-foreground` (crisp, high-contrast)
  - Secondary metadata: `text-muted-foreground`
  - Data / Numerical: `font-mono` with `tabular-nums`
- **Status Accents**:
  - Quoted / Delivered: Emerald (`text-emerald-400`, `bg-emerald-500/10`, `border-emerald-500/30`)
  - In Clarification / In Flight: Amber (`text-amber-400`, `bg-amber-500/10`, `border-amber-500/30`)
  - Needs Review: Rose (`text-rose-400`, `bg-rose-500/10`, `border-rose-500/30`)
  - Processing: Sky (`text-sky-400`, `bg-sky-500/10`, `border-sky-500/30`)
  - Discarded / Parked: Zinc/Slate (`text-muted-foreground`, `bg-muted/40`)

## 3. Typography
- **Primary Typeface**: Inter / Geist Sans (`font-sans`)
- **Code / Data Typeface**: JetBrains Mono / Geist Mono (`font-mono`)
- **Scale**:
  - Micro / Labels: `text-[10px]` - `text-[11px]` (uppercase tracking-wider or pill badges)
  - Regular Body: `text-xs` - `text-sm`
  - Section Headings: `text-base` - `text-lg` font-semibold / font-bold
  - Numerical Values: `text-lg` - `text-xl` font-bold font-mono tracking-tight

## 4. Redesigned Primary Surfaces
1. **Quotation Inbox (`/`)**:
   - **Real-Time KPI HUD**: 4 core operational metrics across the top (Active Proposals, In-Flight Clarifications, Human Review Needed, Turnaround Latency).
   - **Status Filter Ribbon**: Compact buttons with real-time counters and keyboard shortcuts (`1` to `5`).
   - **High-Density Thread Master View**: Tinted initials avatars, inline requirement chips (Hosts, URLs, RUM, Logs), turn indicators (`Turn X/3`), and formatted INR quote badges.
   - **Integrated Inspector Pane**: 6-unit sizing matrix, verified RFC header tokens (`Message-ID`, `In-Reply-To`, `References`), and quick action buttons.

2. **Thread Detail Workspace (`/threads/[id]`)**:
   - **Dual-Pane Layout**: Chronological message timeline on the left; structured inspector on the right.
   - **Message Cards**: Directional indicator chips (`Inbound` vs `Automated Dispatch`), RFC header viewer, delivery status pill (`delivered`, `queued`, `failed`), and attachment badges.
   - **Tabbed Inspector**:
     - *Tab 1: Sizing Matrix*: 6-unit requirement audit displaying extracted quantities, units, and status.
     - *Tab 2: Plan Breakdown*: Itemized line items, annual pricing, add-on quantities, and candidate comparison.
     - *Tab 3: AI Provenance*: AI decision log with rule citations, confidence scores, rationale, and model provenance.

## 5. Motion Architecture & Choreography (`motion/react`)
- **Philosophy**: Motion serves feedback, state, spatial continuity, and tactile velocity. Decoration without purpose is rejected. Routine state changes are snappy (150–220ms).
- **Primitives Used**:
  - `motion.div`, `motion.span`, `motion.button`
  - `AnimatePresence` with `mode="popLayout"` and `mode="wait"`
  - `LayoutGroup` for shared list layout context
  - `useReducedMotion` for immediate accessibility compliance
- **Key Choreographed Moments**:
  1. **Sliding Indicator Glides (`layoutId`)**:
     - Status Filter Ribbon: `layoutId="activeFilterPill"` gliding with spring physics `{ type: "spring", stiffness: 450, damping: 35 }`.
     - Thread Inspector Tabs: `layoutId="threadInspectorActiveTab"` smoothly transitioning between Sizing Matrix, Plan Breakdown, and AI Provenance.
     - Selected Thread Ring: `layoutId="selectedThreadRing"` wrapping active conversation card.
  2. **List Item Fluid Layouts**:
     - Thread items animate dynamically using FLIP-style layout repositioning when filtering or searching (`layout`, `initial={{ opacity: 0, y: 8 }}`, `exit={{ opacity: 0, scale: 0.97 }}`).
  3. **Collapsible Disclosures**:
     - RFC Threading Identifiers & header trays animate height (`0` to `auto`) and opacity with exit animations for zero-jarring toggling.
     - Quote line item breakdown expands smoothly.
  4. **Action Feedback & Notifications**:
     - Toast notifications enter with `y: -10, scale: 0.98` to `y: 0, scale: 1` with clean spring dismiss.
- **Accessibility (`prefers-reduced-motion`)**:
  - Automatically queries `useReducedMotion()`.
  - When reduced motion is requested, spatial movement and spring physics fall back to instant or opacity-only state indicators.

