"""Relational store — the transactional record of truth.

Schema mirrors db/postgres_init.sql from the system design:

  trial_participants            PII ledger (decoupled from research data)
  cryptographic_consent_tokens  KMS-signed DPDP 2023 consent commitments
  sdtm_research_observations    CDISC SDTM-grounded research observations

Row-Level Security note: PostgreSQL enforces consent via `CREATE POLICY
rls_enforce_consent_token ... USING (EXISTS (... is_active ...))`. SQLite has
no RLS, so the exact same predicate is enforced in code on every read path
(`fetch_observations`) and on the webhook consent gate — the audit trail shows
identical behaviour. Swapping to PostgreSQL re-enables the native policy.
"""

import sqlite3
import threading
import uuid
from datetime import datetime, timezone

from . import config
from .crypto import kms

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def connect(db_path: str = config.SQLITE_PATH) -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is not None:
            return _conn
        conn = sqlite3.connect(db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS trial_participants (
                participant_id TEXT PRIMARY KEY,
                abha_id        TEXT UNIQUE NOT NULL,
                site           TEXT,
                trial_id       TEXT,
                age            INTEGER,
                sex            TEXT,
                status         TEXT NOT NULL DEFAULT 'ACTIVE',
                enrolled_at    TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS cryptographic_consent_tokens (
                token_id        TEXT PRIMARY KEY,
                participant_id  TEXT NOT NULL REFERENCES trial_participants(participant_id) ON DELETE CASCADE,
                consent_tier    TEXT NOT NULL,
                kms_key_version TEXT NOT NULL,
                token_signature TEXT NOT NULL,
                is_active       INTEGER NOT NULL DEFAULT 1,
                granted_at      TEXT NOT NULL,
                revoked_at      TEXT,
                UNIQUE (participant_id, consent_tier)
            );
            CREATE TABLE IF NOT EXISTS sdtm_research_observations (
                observation_id    TEXT PRIMARY KEY,
                participant_id    TEXT NOT NULL REFERENCES trial_participants(participant_id),
                domain            TEXT NOT NULL,
                sdtm_variable     TEXT NOT NULL,
                sdtm_value        TEXT NOT NULL,
                recorded_at       TEXT NOT NULL,
                audit_trail_user_id TEXT NOT NULL,
                locked            INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_obs_participant
                ON sdtm_research_observations(participant_id);
            CREATE INDEX IF NOT EXISTS idx_consent_active
                ON cryptographic_consent_tokens(participant_id, is_active);
            CREATE TABLE IF NOT EXISTS safety_adverse_events (
                ae_id            TEXT PRIMARY KEY,
                participant_id   TEXT NOT NULL,
                trial_id         TEXT,
                formulation      TEXT,
                note             TEXT,
                extracted_term   TEXT,
                ic_score         REAL,
                severity         TEXT,
                detected_at      TEXT NOT NULL,
                ct04_status      TEXT,
                ct04_deadline    TEXT,
                ct04_submitted_at TEXT
            );
            """
        )
        conn.commit()
        _conn = conn
        return conn


# ── Consent ledger ──────────────────────────────────────────────────────────

def grant_consent(participant_id: str, tier: str) -> dict | None:
    conn = connect()
    if not get_participant(participant_id):
        return None
    key_uri, signature = kms.sign_consent_state(participant_id, tier, True)
    with _lock:
        conn.execute(
            """INSERT INTO cryptographic_consent_tokens
                 (token_id, participant_id, consent_tier, kms_key_version,
                  token_signature, is_active, granted_at)
               VALUES (?, ?, ?, ?, ?, 1, ?)
               ON CONFLICT(participant_id, consent_tier) DO UPDATE SET
                 is_active = 1, revoked_at = NULL,
                 kms_key_version = excluded.kms_key_version,
                 token_signature = excluded.token_signature
            """,
            (new_id(), participant_id, tier, key_uri, signature, utcnow()),
        )
        conn.commit()
    return {"participant_id": participant_id, "tier": tier, "key_uri": key_uri}


def verify_consent(participant_id: str, tier: str = config.TIER_T1) -> bool:
    """The webhook consent gate — mirrors the RLS predicate."""
    conn = connect()
    row = conn.execute(
        """SELECT 1 FROM cryptographic_consent_tokens
            WHERE participant_id = ? AND consent_tier = ? AND is_active = 1""",
        (participant_id, tier),
    ).fetchone()
    return row is not None


def revoke_all_consent(participant_id: str) -> dict:
    """DPDP §6 revocation cascade — the Dynamic Retrospective Data Lock.

    1. rotate the KMS key version (old signatures become unverifiable)
    2. deactivate every token the participant ever granted
    3. append the D_LOCK audit marker, frozen under the retention rule
    4. purge direct identifiers from the participant ledger
    """
    conn = connect()
    rotated_to = kms.rotate()
    now = utcnow()
    with _lock:
        conn.execute(
            """UPDATE cryptographic_consent_tokens
                  SET is_active = 0, revoked_at = ?
                WHERE participant_id = ? AND is_active = 1""",
            (now, participant_id),
        )
        conn.execute(
            """INSERT INTO sdtm_research_observations
                 (observation_id, participant_id, domain, sdtm_variable,
                  sdtm_value, recorded_at, audit_trail_user_id, locked)
               VALUES (?, ?, 'DM', 'D_LOCK', 'CONSENT_REVOKED', ?, 'SECURITY_CORE', 1)""",
            (new_id(), participant_id, now),
        )
        conn.execute(
            "UPDATE trial_participants SET status = 'LOCKED', abha_id = ? WHERE participant_id = ?",
            (f"PURGED-{participant_id}", participant_id),
        )
        conn.execute(
            "UPDATE sdtm_research_observations SET locked = 1 WHERE participant_id = ?",
            (participant_id,),
        )
        conn.commit()
    return {
        "participant_id": participant_id,
        "kms_rotated_to": kms.key_uri_at(rotated_to),
        "locked_at": now,
    }


def list_tokens(participant_id: str) -> list[dict]:
    conn = connect()
    rows = conn.execute(
        """SELECT token_id, consent_tier, kms_key_version, token_signature,
                  is_active, granted_at, revoked_at
             FROM cryptographic_consent_tokens
            WHERE participant_id = ?
            ORDER BY granted_at""",
        (participant_id,),
    ).fetchall()
    return [dict(r) | {"is_active": bool(r["is_active"])} for r in rows]


# ── Participants ────────────────────────────────────────────────────────────

def get_participant(participant_id: str) -> dict | None:
    conn = connect()
    row = conn.execute(
        "SELECT * FROM trial_participants WHERE participant_id = ?",
        (participant_id,),
    ).fetchone()
    return dict(row) if row else None


def list_participants(trial_id: str | None = None) -> list[dict]:
    conn = connect()
    if trial_id:
        rows = conn.execute(
            "SELECT * FROM trial_participants WHERE trial_id = ? ORDER BY participant_id",
            (trial_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM trial_participants ORDER BY participant_id"
        ).fetchall()
    return [dict(r) for r in rows]


# ── SDTM observations ───────────────────────────────────────────────────────

def insert_observation(
    participant_id: str,
    domain: str,
    variable: str,
    value: str,
    audit_user: str = "SYSTEM_AYUBRIDGE",
) -> str:
    conn = connect()
    obs_id = new_id()
    with _lock:
        conn.execute(
            """INSERT INTO sdtm_research_observations
                 (observation_id, participant_id, domain, sdtm_variable,
                  sdtm_value, recorded_at, audit_trail_user_id, locked)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0)""",
            (obs_id, participant_id, domain, variable, value, utcnow(), audit_user),
        )
        conn.commit()
    return obs_id


def fetch_observations(participant_id: str) -> list[dict]:
    """RLS-equivalent read: no active T1 token -> the rows are invisible."""
    if not verify_consent(participant_id, config.TIER_T1):
        return []
    conn = connect()
    rows = conn.execute(
        """SELECT * FROM sdtm_research_observations
            WHERE participant_id = ? ORDER BY recorded_at DESC""",
        (participant_id,),
    ).fetchall()
    return [dict(r) | {"locked": bool(r["locked"])} for r in rows]


def count_observations() -> int:
    conn = connect()
    (n,) = conn.execute("SELECT COUNT(*) FROM sdtm_research_observations").fetchone()
    return n
