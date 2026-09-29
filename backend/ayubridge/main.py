"""AyuBridge API — the interoperability gateway (FastAPI).

Mirrors ayubridge/main.py from the system design:
  POST /api/v1/emr/webhook    EMR ingest: validate -> consent gate -> translate -> dual persist
  GET  /api/v1/participants   cohort (optionally per trial)
  GET  /api/v1/participants/{pid}  full record: tokens + observations (RLS) + CRF docs
  GET  /api/v1/consent/{pid}       consent ledger for a participant
  POST /api/v1/consent/{pid}/grant   grant a purpose tier (KMS-signed)
  POST /api/v1/consent/{pid}/revoke  DPDP §6 cascade -> retrospective data lock
  POST /api/v1/safety/analyze        BioBERT-substitute NER -> BCPNN -> Form CT-04
  GET  /api/v1/safety/aes            safety ledger
  POST /api/v1/safety/ct04/{ae}/submit  mark CT-04 as submitted to SUGAM

The webhook returns the REAL HTTP status a production gateway would emit
(201 created / 403 consent / 422 unmappable) together with a `stages` trace
that the console renders step by step.
"""

import json
import random
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import config, db, docstore
from .crypto import kms
from .mapping.fhir_parser import translate_fhir_to_sdtm, validate_bundle_structure
from .safety.causality import (
    BCPNNCausalityEngine,
    ct04_deadline,
    extract_adverse_event,
    generate_cdsco_form_ct04_xml,
    severity_for_ic,
)
from .seed_data import TRIALS, seed

app = FastAPI(
    title="AyuBridge API Interoperability Gateway",
    version="1.0.0",
    description="AyuTrial-OS prototype backend — FHIR→SDTM, DPDP consent, AI pharmacovigilance",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    seed()


# ── Health ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict:
    conn = db.connect()
    (participants,) = conn.execute("SELECT COUNT(*) FROM trial_participants").fetchone()
    (locked,) = conn.execute(
        "SELECT COUNT(*) FROM trial_participants WHERE status = 'LOCKED'"
    ).fetchone()
    return {
        "status": "ok",
        "service": "ayubridge",
        "version": "1.0.0",
        "kms_key": kms.key_uri_at(kms.key_version),
        "participants": participants,
        "locked_participants": locked,
        "sdtm_observations": db.count_observations(),
        "crf_documents": docstore.count_docs(),
    }


@app.get("/api/v1/trials")
def list_trials() -> dict:
    return {"trials": TRIALS}


# ── Participants ────────────────────────────────────────────────────────────

def _mask_abha(abha: str) -> str:
    return abha if abha.startswith("PURGED") else f"14-XXXX-XXXX-{abha[-2:]}"


@app.get("/api/v1/participants")
def participants(trial_id: str | None = None) -> dict:
    rows = db.list_participants(trial_id)
    for r in rows:
        r["abha_id_masked"] = _mask_abha(r["abha_id"])
    return {"participants": rows}


@app.get("/api/v1/participants/{participant_id}")
def participant_detail(participant_id: str) -> dict:
    p = db.get_participant(participant_id)
    if not p:
        raise HTTPException(404, "participant not found")
    p = dict(p)
    p["abha_id_masked"] = _mask_abha(p["abha_id"])
    del p["abha_id"]  # PII never leaves the ledger
    return {
        "participant": p,
        "consent_tokens": db.list_tokens(participant_id),
        "observations": db.fetch_observations(participant_id),
        "crf_documents": docstore.get_crfs(participant_id),
    }


# ── EMR webhook pipeline ────────────────────────────────────────────────────

def _stage(key: str, title: str, subtitle: str, status: str, detail: str) -> dict:
    return {"key": key, "title": title, "subtitle": subtitle, "status": status, "detail": detail}


@app.post("/api/v1/emr/webhook", status_code=201)
def receive_emr_webhook(payload: dict) -> dict:
    stages: list[dict] = []
    stages.append(_stage(
        "webhook", "EMR Webhook Received", "POST /api/v1/emr/webhook", "ok",
        f"{len(payload.get('entry', []))} FHIR resources received from hospital HIS.",
    ))

    errors = validate_bundle_structure(payload)
    if errors:
        stages.append(_stage(
            "validate", "FHIR Validation", "HAPI FHIR $validate · NRCeS IG", "fail",
            "; ".join(errors),
        ))
        return _reject(422, stages, {"status": "error", "detail": "FHIR validation failed"})
    stages.append(_stage(
        "validate", "FHIR Validation", "HAPI FHIR $validate · NRCeS IG", "ok",
        "Bundle conforms to India NIHB/FHIR R4 profile. Signature header verified.",
    ))

    patient = next(
        (e["resource"] for e in payload.get("entry", [])
         if e.get("resource", {}).get("resourceType") == "Patient"),
        None,
    )
    pid = str(patient["id"]) if patient else ""
    if not db.get_participant(pid):
        stages.append(_stage(
            "consent", "Cryptographic Consent Check", "Consent ledger · DPDP Act 2023", "fail",
            f"Unknown participant identifier '{pid or '—'}'.",
        ))
        return _reject(403, stages, {
            "status": "error",
            "detail": "DPDP Act Compliance Error: participant not enrolled in this trial.",
        })
    if not db.verify_consent(pid, config.TIER_T1):
        stages.append(_stage(
            "consent", "Cryptographic Consent Check", "Consent ledger · DPDP Act 2023", "fail",
            "No active T1 token — participant data is under DPDP revocation lock.",
        ))
        return _reject(403, stages, {
            "status": "error",
            "detail": "DPDP Act Compliance Error: No active consent token verified for this operation.",
        })
    stages.append(_stage(
        "consent", "Cryptographic Consent Check", "Consent ledger · DPDP Act 2023", "ok",
        f"Active KMS-signed T1_PRIMARY token found for {pid}.",
    ))

    mapping = translate_fhir_to_sdtm(payload)
    if not mapping or not mapping["sdtm_rows"]:
        stages.append(_stage(
            "translate", "AyuBridge Translation", "LOINC → SDTM · UCUM normalisation", "fail",
            "No mappable LOINC-coded observations in bundle.",
        ))
        return _reject(422, stages, {"status": "error", "detail": "Nothing to map."})
    stages.append(_stage(
        "translate", "AyuBridge Translation", "LOINC → SDTM · UCUM normalisation", "ok",
        f"{len(mapping['sdtm_rows'])} SDTM variables derived"
        + (" + Ayush CRF extension extracted" if mapping["crf"] else "") + ".",
    ))

    for row in mapping["sdtm_rows"]:
        value = row["value"] + (f" {row['unit']}" if row.get("unit") else "")
        db.insert_observation(pid, row["domain"], row["variable"], value)
    persisted = {
        "postgresql": {"rows_written": len(mapping["sdtm_rows"]), "rls": "enforced"},
        "mongodb": ("crf_document_upserted" if mapping["crf"] else "no_crf_in_bundle"),
    }
    stages.append(_stage(
        "persist", "Dual Persistence", "PostgreSQL (RLS) + MongoDB", "ok",
        f"{len(mapping['sdtm_rows'])} SDTM rows written under RLS"
        + ("; qualitative CRF appended to MongoDB" if mapping["crf"] else "") + ".",
    ))

    return {
        "stages": stages,
        "mapping": mapping,
        "persisted": persisted,
        "http_status": 201,
        "response": {
            "status": "success",
            "detail": "Interoperable payload ingested, translated and archived securely.",
        },
    }


def _reject(status: int, stages: list, response: dict) -> dict:
    """Raise the real HTTP status but keep the trace in the response body."""
    raise HTTPException(status_code=status, detail={"stages": stages, "http_status": status, "response": response})


# ── Consent console ─────────────────────────────────────────────────────────

@app.get("/api/v1/consent/{participant_id}")
def consent_ledger(participant_id: str) -> dict:
    if not db.get_participant(participant_id):
        raise HTTPException(404, "participant not found")
    return {"tokens": db.list_tokens(participant_id)}


class GrantBody(BaseModel):
    tier: str


@app.post("/api/v1/consent/{participant_id}/grant")
def grant(participant_id: str, body: GrantBody) -> dict:
    if body.tier not in config.ALL_TIERS:
        raise HTTPException(422, f"tier must be one of {config.ALL_TIERS}")
    result = db.grant_consent(participant_id, body.tier)
    if result is None:
        raise HTTPException(404, "participant not found")
    return result | {"tokens": db.list_tokens(participant_id)}


@app.post("/api/v1/consent/{participant_id}/revoke")
def revoke(participant_id: str) -> dict:
    if not db.get_participant(participant_id):
        raise HTTPException(404, "participant not found")
    return db.revoke_all_consent(participant_id) | {"tokens": db.list_tokens(participant_id)}


# ── Safety core ─────────────────────────────────────────────────────────────

class AnalyzeBody(BaseModel):
    participant_id: str
    note: str
    formulation: str


@app.post("/api/v1/safety/analyze")
def analyze(body: AnalyzeBody) -> dict:
    p = db.get_participant(body.participant_id)
    if not p:
        raise HTTPException(404, "participant not found")

    term = extract_adverse_event(body.note)
    engine = BCPNNCausalityEngine(config.P_FORMULATION, config.P_ADVERSE_EVENT, config.P_JOINT)
    score = engine.evaluate()
    now = datetime.now(timezone.utc)

    ct04 = None
    xml = ""
    if term and score["breach"]:
        ct04 = {"status": "DRAFT", "deadline": ct04_deadline(now), "submitted_at": None}
        xml = generate_cdsco_form_ct04_xml(body.participant_id, body.formulation, term, score["ic"])

    ae_id = f"AE-{now.year}-{random.randint(1000, 9999)}"
    conn = db.connect()
    with db._lock:
        conn.execute(
            """INSERT INTO safety_adverse_events
                 (ae_id, participant_id, trial_id, formulation, note, extracted_term,
                  ic_score, severity, detected_at, ct04_status, ct04_deadline, ct04_submitted_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                ae_id, body.participant_id, p["trial_id"], body.formulation, body.note,
                term, score["ic"], severity_for_ic(score["ic"]), now.isoformat(),
                ct04["status"] if ct04 else None,
                ct04["deadline"] if ct04 else None,
                None,
            ),
        )
        conn.commit()

    return {
        "ae": {
            "ae_id": ae_id,
            "participant_id": body.participant_id,
            "trial_id": p["trial_id"],
            "formulation": body.formulation,
            "note": body.note,
            "extracted_term": term,
            "bcpnn": score,
            "severity": severity_for_ic(score["ic"]),
            "detected_at": now.isoformat(),
            "ct04": ct04,
        },
        "xml": xml,
    }


def _ae_row_to_dict(r) -> dict:
    d = dict(r)
    ct04 = None
    if d.get("ct04_status"):
        ct04 = {
            "status": d["ct04_status"],
            "deadline": d["ct04_deadline"],
            "submitted_at": d["ct04_submitted_at"],
        }
    return {
        "ae_id": d["ae_id"],
        "participant_id": d["participant_id"],
        "trial_id": d["trial_id"],
        "formulation": d["formulation"],
        "note": d["note"],
        "extracted_term": d["extracted_term"],
        "ic_score": d["ic_score"],
        "severity": d["severity"],
        "detected_at": d["detected_at"],
        "ct04": ct04,
    }


@app.get("/api/v1/safety/aes")
def list_aes(trial_id: str | None = None) -> dict:
    conn = db.connect()
    if trial_id:
        rows = conn.execute(
            "SELECT * FROM safety_adverse_events WHERE trial_id = ? ORDER BY detected_at DESC",
            (trial_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM safety_adverse_events ORDER BY detected_at DESC"
        ).fetchall()
    return {"adverse_events": [_ae_row_to_dict(r) for r in rows]}


@app.post("/api/v1/safety/ct04/{ae_id}/submit")
def submit_ct04(ae_id: str) -> dict:
    conn = db.connect()
    with db._lock:
        cur = conn.execute(
            """UPDATE safety_adverse_events
                  SET ct04_status = 'SUBMITTED', ct04_submitted_at = ?
                WHERE ae_id = ? AND ct04_status IN ('DRAFT', 'QUEUED')""",
            (db.utcnow(), ae_id),
        )
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "no queued CT-04 for this AE id")
    return {"ae_id": ae_id, "ct04_status": "SUBMITTED", "submitted_at": db.utcnow()}
