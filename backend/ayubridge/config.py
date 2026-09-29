"""AyuTrial-OS backend configuration.

Mirrors .env.production from the system design; every cloud dependency is
replaced by a local, zero-install equivalent so the prototype boots anywhere:

  PostgreSQL 16  ->  SQLite (ayutrial.db) — same tables, RLS semantics in code
  MongoDB 7.0    ->  JSON document store (ayutrial_mongo.json)
  GCP Cloud KMS  ->  versioned HMAC-SHA256 signing keys (crypto.py)
  HAPI FHIR      ->  structural conformance checks (mapping stage)
  vLLM / BioBERT ->  deterministic clinical-NER substitute (safety/causality.py)

Swapping to the real services is a driver change, not a logic change: every
touchpoint is isolated in db.py / docstore.py / crypto.py.
"""

SQLITE_PATH = "ayutrial.db"
MONGO_JSON_PATH = "ayutrial_mongo.json"

GCP_PROJECT_ID = "ayutrial-sovereign-production"
KMS_KEY_RING = "ayutrial-consent-ring"
KMS_KEY_NAME = "consent-signing-key"

# Consent tiers (DPDP Act 2023 purpose limitation)
TIER_T1 = "T1_PRIMARY"
TIER_T2 = "T2_SECONDARY"
TIER_T3 = "T3_GENOMIC"
ALL_TIERS = (TIER_T1, TIER_T2, TIER_T3)

# BCPNN pharmacovigilance statistics (production: cohort DB weights)
P_FORMULATION = 0.10   # P(A): population exposure to the formulation
P_ADVERSE_EVENT = 0.02 # P(B): background incidence of the event
P_JOINT = 0.04         # P(A,B): observed co-occurrence
IC_THRESHOLD = 1.5     # breach -> mandatory CDSCO Form CT-04
CT04_DEADLINE_HOURS = 24

CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
