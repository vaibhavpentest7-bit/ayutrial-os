"""Document store — MongoDB stand-in for the Ayurvedic CRF collection.

Mirrors db/mongo_init.js: collection `ayurvedic_crf_observations` with the
$JSONSchema validator (Prakriti / Agni / Koshtha enums) and the unique index
on (participant_id, visit_number). Documents persist to a JSON file so the
store survives restarts; swapping in pymongo is a driver change only.
"""

import json
import os
import threading
from datetime import datetime, timezone

from . import config

_lock = threading.Lock()
_docs: list[dict] | None = None

VALID_AGNI = {"Manda", "Teekshna", "Vishama", "Sama"}
VALID_KOSHTHA = {"Mridu", "Madhyama", "Kroora"}
VALID_DOSHA = {"Vata", "Pitta", "Kapha", "None"}


def _load() -> list[dict]:
    global _docs
    with _lock:
        if _docs is not None:
            return _docs
        if os.path.exists(config.MONGO_JSON_PATH):
            with open(config.MONGO_JSON_PATH, "r", encoding="utf-8") as fh:
                _docs = json.load(fh)
        else:
            _docs = []
        return _docs


def _flush() -> None:
    with open(config.MONGO_JSON_PATH, "w", encoding="utf-8") as fh:
        json.dump(_docs, fh, indent=2)


def validate_crf_document(doc: dict) -> list[str]:
    """The $jsonSchema validator from mongo_init.js, as code."""
    errors: list[str] = []
    for field in ("participant_id", "visit_number", "recorded_at", "ayurvedic_variables"):
        if field not in doc:
            errors.append(f"missing required field: {field}")
    if errors:
        return errors
    v = doc["ayurvedic_variables"]
    prakriti = v.get("prakriti", {})
    if prakriti.get("primary_dosha") not in {"Vata", "Pitta", "Kapha"}:
        errors.append("prakriti.primary_dosha must be Vata | Pitta | Kapha")
    if prakriti.get("secondary_dosha") not in VALID_DOSHA:
        errors.append("prakriti.secondary_dosha invalid")
    if v.get("agni", {}).get("metabolic_state") not in VALID_AGNI:
        errors.append("agni.metabolic_state must be Manda | Teekshna | Vishama | Sama")
    if v.get("koshtha", {}).get("motility_state") not in VALID_KOSHTHA:
        errors.append("koshtha.motility_state must be Mridu | Madhyama | Kroora")
    return errors


def upsert_crf(doc: dict) -> dict:
    """update_one(..., upsert=True) on the (participant_id, visit_number) index."""
    errors = validate_crf_document(doc)
    if errors:
        return {"acknowledged": False, "validation_errors": errors}
    docs = _load()
    with _lock:
        for i, existing in enumerate(docs):
            if (
                existing["participant_id"] == doc["participant_id"]
                and existing["visit_number"] == doc["visit_number"]
            ):
                docs[i] = doc
                _flush()
                return {"acknowledged": True, "matched": 1, "upserted": False}
        docs.append(doc)
        _flush()
    return {"acknowledged": True, "matched": 0, "upserted": True}


def get_crfs(participant_id: str) -> list[dict]:
    return [d for d in _load() if d["participant_id"] == participant_id]


def count_docs() -> int:
    return len(_load())
