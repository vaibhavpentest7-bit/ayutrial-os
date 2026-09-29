# AyuTrial-OS — GCP-Compliant Ayurveda Clinical Research Platform

**Smart India Hackathon 2026 · Working Prototype**

AyuTrial-OS modernises Ayurveda clinical research with the one thing it is missing today: a
digital backbone that hospitals, regulators and researchers can all trust. The platform speaks
**HL7 FHIR** (what hospital EMRs emit), speaks **CDISC SDTM** (what global regulators expect),
enforces **DPDP Act 2023** consent cryptographically at the database layer, and runs an AI
pharmacovigilance pipeline that meets the **NDCT Rules 2019** 24-hour serious-adverse-event
reporting mandate.

---

## Quick start

**Frontend** (works standalone — engines run in-browser):
```bash
cd ayutrial-os
npm install
npm run dev        # → http://localhost:5173
```

**Backend** — the real AyuBridge FastAPI gateway (recommended for the demo):
```bash
cd ayutrial-os/backend
./run.sh           # → http://localhost:8000  (interactive API docs at /docs)
```
The frontend auto-detects the backend on load — the sidebar chip flips from
`BROWSER ENGINES · SIMULATED` to `AYUBRIDGE BACKEND · LIVE :8000`, and every
webhook, consent grant/revoke and safety analysis then executes server-side
against SQLite + a JSON document store (zero external services needed). If the
backend goes down mid-demo, the app silently falls back to the in-browser
engines — the demo cannot break on stage.

## API surface (FastAPI, mirrors the production design)

| Endpoint | What it does |
| --- | --- |
| `POST /api/v1/emr/webhook` | EMR ingest: FHIR validation → DPDP consent gate → LOINC/UCUM→SDTM translation → dual persistence. Returns the **real** status codes: `201` created, `403` consent violation, `422` unmappable — plus the per-stage trace the console renders |
| `GET /api/v1/participants[/{id}]` | Cohort & full participant record (tokens, observations behind the RLS-equivalent read, CRF docs). PII never leaves the ledger |
| `GET/POST /api/v1/consent/{pid}…` | Consent ledger, `grant` (KMS-signed token), `revoke` (key rotation → PII purge → `D_LOCK` cascade) |
| `POST /api/v1/safety/analyze` | AE extraction → BCPNN IC scoring → Form CT-04 XML compilation with 24-h deadline |
| `GET /api/v1/safety/aes`, `POST /api/v1/safety/ct04/{ae}/submit` | Safety ledger & SUGAM submission |
| `GET /health` | Service + KMS + ledger stats |

Backend layout mirrors the production repo one-to-one:
```
backend/
├── run.sh
└── ayubridge/
    ├── main.py               # FastAPI gateway (webhook + REST)
    ├── config.py             # .env.production equivalents
    ├── crypto.py             # Cloud-KMS stand-in: versioned HMAC consent signing + rotation
    ├── db.py                 # Postgres schema (SQLite driver) + RLS-equivalent read policy
    ├── docstore.py           # MongoDB collection + $jsonSchema validator (JSON driver)
    ├── seed_data.py          # deterministic seed, same PRNG as the frontend
    ├── mapping/fhir_parser.py  # LOINC dictionary, UCUM normaliser, Ayush extension parser
    └── safety/causality.py     # AE lexicon NER, BCPNN engine, Form CT-04 compiler
```

---

## The 5-minute demo script

> Every screen below is in the left sidebar. Use the trial selector
> (`AYU-RCT-2026-014 — Ashwagandha Ghan Vati`) at the top right.

### 1. Command Centre — the portfolio view
- Trial banner with CDSCO approval ID, phase and enrollment progress ring.
- KPIs: consent coverage, SDTM record volume, open AEs, data locks.
- Point out the **Prakriti distribution donut** — traditional diagnostics living alongside
  modern trial metrics.

### 2. AyuBridge Interop — the interoperability engine ⭐ (the money demo)
1. Pick scenario **“Vitals + Ayush CRF extension”** (pre-selected).
2. Press **“Send webhook →”**.
3. Watch the pipeline trace light up stage by stage:
   `EMR webhook → FHIR validation (NRCeS) → DPDP consent gate → LOINC/UCUM translation → dual persistence`.
4. The output panel shows the **CDISC SDTM mapping table** — every row carries its LOINC code
   and UCUM transformation note (e.g. `154.3 lb × 0.45359237 → kg`).
5. The **Ayurvedic CRF card** shows Prakriti/Agni/Koshtha extracted from the Ministry-of-Ayush
   FHIR extension and stored as a MongoDB document.
6. **Kill-shot:** go to Consent Vault first (step 4), revoke a participant, come back, select
   them, fire the webhook again → the consent gate rejects with **HTTP 403 DPDP Compliance
   Error**. Compliance you can *see*.

### 3. Participants — the integrative record
- Click any row: demographics (masked), KMS-signed consent tokens, the Ayurvedic CRF
  (Prakriti/Agni/Koshtha with clinical interpretation) and the raw SDTM observation table —
  modern and traditional data joined on one participant UUID.

### 4. Consent Vault — DPDP Act 2023, enforced
- Granular tiers: **T1 primary / T2 secondary / T3 genomic** — each purpose gets its own
  KMS-signed token.
- Press **“⚠ Revoke all consent → data lock”** on any participant:
  - every token flips to `REVOKED`,
  - the participant record shows **PII PURGED (DPDP §6)**,
  - observations freeze and a `D_LOCK / CONSENT_REVOKED` marker is appended,
  - the audit ledger logs the KMS key-version rotation.
- This is the “right to be forgotten” reconciled with the NDCT 5-year retention rule.

### 5. Safety Core — AI pharmacovigilance ⭐
1. Pick the sample note (or paste your own) and press **“Run safety pipeline →”**.
2. BioBERT-style extraction pulls the adverse-event term from free text.
3. The **BCPNN information component** quantifies causality: `IC = log₂(P(A,B)/(P(A)·P(B)))`.
4. When **IC > 1.5** the system flags a breach and auto-compiles a **CDSCO Form CT-04** XML
   draft with a 24-hour countdown to the NDCT mandate — then queue it for SUGAM submission.
5. Play with the sliders: raise **P(A,B)** and watch the gauge swing past the threshold live.

### 6. Architecture — from prototype to production
The deployment blueprint (FastAPI AyuBridge core, PostgreSQL with row-level security +
pgvector, MongoDB, GCP Cloud KMS, Keycloak, vLLM/BioBERT, Celery/RabbitMQ) and the mapping of
every regulatory rule (NDCT 2019, DPDP 2023, ICMR-GCP) to a concrete mechanism in the system.

---

## What is real in this prototype?

| Engine | Frontend (in-browser) | Backend (`./backend/run.sh`) |
| --- | --- | --- |
| FHIR R4 parsing, LOINC mapping, UCUM normalisation (lb→kg, in→cm, °F→°C) | ✅ live | ✅ live in FastAPI, persisted to SQLite |
| Ayush clinical-diagnostics extension → CRF document | ✅ live | ✅ live, schema-validated JSON store (MongoDB contract) |
| BCPNN IC scoring + Form CT-04 XML generation | ✅ live | ✅ live, AE ledger persisted with 24-h deadlines |
| Consent tiers, revocation → data lock (key rotation, PII purge, D_LOCK) | ✅ live | ✅ live — HMAC-signed tokens, version-rotated keys, enforced read policy |
| BioBERT adverse-event extraction | 🔶 deterministic clinical-NER substitute | 🔶 same substitute behind the production async interface (production calls a local vLLM endpoint) |
| Webhook transport, HAPI FHIR validation, PostgreSQL/MongoDB/KMS | 🔶 simulated | 🔶 SQLite + JSON + HMAC stand-ins behind the exact production interfaces — swap drivers, not logic |

Deterministic seed data (mulberry32 PRNG): 3 trials across 4 AYUSH research sites, 20
participants with ABHA identifiers, ~215 SDTM observations, CRF documents, consent tokens and
an adverse-event ledger — identical on every run, so the demo never surprises you.

## Production architecture (what the prototype is designed against)

```
Hospital EMR ──FHIR R4 webhook──▶  AyuBridge (FastAPI)
                                   ├── HAPI FHIR $validate (NRCeS IG)
                                   ├── DPDP consent gate ──▶ PostgreSQL consent ledger
                                   ├── FHIR→SDTM translator (LOINC · UCUM)
                                   ├── Ayush CRF extractor
                                   ▼                ▼
                            PostgreSQL 16      MongoDB 7.0
                            (SDTM + RLS +      (Prakriti/Agni/
                             pgvector)          Koshtha CRF)
                                   ▲
                    Keycloak RBAC ─┴─ GCP Cloud KMS (consent signing/rotation)
                                   │
                     Safety core: BioBERT (vLLM) → BCPNN → Celery → CDSCO Form CT-04 → SUGAM
```

## Tech stack of this prototype

React 18 · TypeScript · Vite · hand-rolled SVG visualisations · zero runtime dependencies
beyond React — `npm run build` emits a fully static bundle that can be served from a pen-drive
demo machine.

---

*All patient data shown is synthetic. CDSCO, SUGAM, ABDM, ABHA and Ayush Research Portal are
referenced as the real systems this platform integrates with.*
