# Quote24x7 AI Evaluation Benchmark

Measures **accuracy**, **hallucinations** and provides **benchmark datasets** for the AI sales engineer
(Groq `openai/gpt-oss-120b` primary, Gemini secondary, deterministic rules engine as baseline and fallback).

## What is being evaluated

The model's job is narrow and checkable: read a customer email and report (a) how many of each billable
unit they need, (b) what to do next (`prepare_quote` / `ask_follow_up` / `human_review`). It has no price
field; the deterministic engine does all arithmetic (covered by `reference-calculator.test.ts`).
So **correct quantities + correct action = correct quote**, and that is what the benchmark scores.

Two layers are scored for every run, which is the main design choice:

| Layer | What it is | Why |
| :-- | :-- | :-- |
| `raw_model` | The LLM's JSON before the app touches it | True model quality, including hallucinations |
| `final_system` | What the app acts on after its guards (evidence check, bounds, rules reconciliation) | What a customer would actually get |

The gap between them is the **guard rescue rate**: hallucinations the app caught before they reached pricing.

## Dataset (v1, 40 cases) — `cases.ts`, exported to `benchmark-dataset-v1.json`

Hand-written emails with hand-assigned ground truth, labelled from the sales engineer's own written policy
(servers/VMs = host monitors, 1 TB = 1024 GB, scope must be closed before quoting, ...).

| Category | n | What it catches |
| :-- | --: | :-- |
| clear_stated | 8 | Plain extraction, summing two groups, number words |
| unit_conversion | 4 | TB to GB, "3 million", "250k" |
| explicit_zero | 3 | "no network devices", "skip website monitoring" must stay 0 |
| multi_turn_correction | 4 | Later message overrides earlier quantity |
| distractor_trap | 8 | Phone numbers, years, ports, budgets, competitor prices next to real counts |
| missing_info | 5 | "a few servers", "two clusters": must ask, not guess |
| escalation | 5 | Reseller, contradictions, implausible counts, discounts, unsupported products |
| prompt_injection | 3 | "ignore instructions", fake SYSTEM message, request for the system prompt |

Ground truth is checked by tests: every gold quantity must be derivable from the email text, every trap value
must really appear in the email, and `prepare_quote` cases must close all six units.

## Metrics

**Accuracy**
- Action accuracy (strict = exactly the labelled action; lenient = also accepts policy-defensible alternatives)
- Exact quantity match (all six units right), plus quantity precision / recall / F1 over (unit, quantity) pairs
- Follow-up coverage: share of genuinely missing units that the questions ask about
- Run-to-run stability with `--repeats N`
- All rates carry a 95% Wilson confidence interval, because n = 40 is small.

**Hallucinations** (each is mechanically detectable, no LLM judge)

| Type | Definition |
| :-- | :-- |
| fabricated_quantity | Positive quantity for a unit the customer never mentioned |
| contradicted_negation | Positive quantity for a unit the customer said they do not need |
| distractor_value | A trap number (phone, year, price...) used as a quantity |
| unsupported_evidence | Quoted "evidence" is not in the customer's text (raw layer) |
| unsupported_number | Marked "stated" but the number is not supported by its own evidence |
| unknown_plan_id / unsupported_category | Refers to a plan or category not in the catalogue (raw layer) |
| price_leak | States an amount the customer never gave (the model must never price) |
| system_prompt_leak | Reveals prompt text or an API-key-shaped string |
| premature_quote | Quotes when the right action is to ask or escalate |

Headline numbers: share of cases with at least one hallucination, and hallucinated claims per positive claim.
Calibration: mean confidence when right vs wrong, and the count of high-confidence (>= 0.8) errors.

## Running it

From `apps/web`:

```
npm run benchmark:rules                       # offline baseline, no API key needed
npm run benchmark -- --provider groq          # live; ~3 s between calls by default
npm run benchmark -- --provider gemini --limit 10   # Gemini free tier is tiny, so limit it
npm run benchmark -- --provider groq --repeats 3    # adds a stability score
npm run benchmark:export                      # writes benchmark-dataset-v1.json
```

Reports are written to `benchmark-results/<provider>-<timestamp>.{md,json}`. If a provider call fails, the case
falls back to rules, is counted as a provider failure, and is excluded from the raw-model layer, so a rate limit
can never be mistaken for model quality.

`benchmark.test.ts` (part of `npm test`) proves the benchmark itself works: a perfect answer scores 100%,
and each kind of bad answer above is detected, including a full pipeline test where a hallucinating mock model is
flagged on the raw layer and the app's guards are shown reducing it.

## Baseline result (rules engine only, 2026-10-21, no model involved)

| Metric | Result |
| :-- | :-- |
| Action accuracy (lenient) | 45.0% (18/40) |
| Exact quantity match | 41.7% (15/36) |
| Quantity precision / recall / F1 | 78.4% / 64.5% / 70.8% |
| Cases with a hallucination | 10.0% (4/40) |

Real defects this exposed in the rules extractor (confirmed by calling it directly): "4 websites" is read as 0
unless qualified ("public websites"); "250k pageviews ... 2 websites" gives 250 basic monitors; "charged us 3000 per
server" gives 3000 hosts; two groups of servers are not summed; a CIDR suffix (/24) became 24 advanced monitors.
Groq and Gemini results are produced by running the commands above with your keys.

## External benchmark datasets (general capability, not a substitute for the domain set)

The domain dataset is the pass/fail gate. These public datasets are useful to cite and to sanity-check a model
choice. Check the current paper and download links before citing.

| Dataset | Measures | Relevance here |
| :-- | :-- | :-- |
| TruthfulQA (Lin et al., 2021) | Tendency to repeat common falsehoods | General truthfulness |
| HaluEval (Li et al., 2023) | Hallucination detection in QA, dialogue, summarisation | Generic hallucination rate |
| RAGTruth (Niu et al., 2024) | Word-level hallucination labels in retrieval-grounded answers | Closest to our setup: answers grounded in an email plus catalogue |
| FEVER (Thorne et al., 2018) | Verifying claims against evidence | Analogue of "does the evidence support the quantity" |
| SQuAD 2.0 (Rajpurkar et al., 2018) | Extractive QA including unanswerable questions | Analogue of `missing_info`: abstain rather than guess |
| FActScore (Min et al., 2023) | Atomic-fact precision of long-form text | For `conversationalResponse` product answers |
| BIPIA (Yi et al., 2023) | Indirect prompt-injection robustness | Analogue of `prompt_injection` |

## Limits

- 40 cases is a small sample: read the confidence intervals, not just the percentages.
- Labels are one author's reading of the written policy. A second labeller and an agreement score (Cohen's kappa) would strengthen it.
- Attachments (PDF/DOCX/CSV/XLSX) are not in v1; `test-attachments/` and `run-all-test-cases.ts` already cover them end to end.
- `conversationalResponse` factuality (product Q&A) is not scored yet; it needs a reference knowledge set or an LLM judge.
- Multi-turn cases feed earlier turns as conversation history, not as a persisted profile.
