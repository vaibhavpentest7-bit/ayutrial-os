"""HL7 FHIR -> CDISC SDTM translator.

Production port of ayubridge/mapping/fhir_parser.py: demultiplexes the EMR
bundle, maps LOINC-coded Observations to SDTM VS/LB variables with UCUM unit
normalisation, and lifts the Ministry-of-Ayush clinical-diagnostics extension
into the Ayurvedic CRF document shape.
"""

from typing import Any

# LOINC -> SDTM variable dictionary (SDTMIG VS/LB domains)
LOINC_SDTM: dict[str, dict[str, str]] = {
    "29463-7": {"variable": "WEIGHT", "label": "Body Weight", "domain": "VS", "unit": "kg"},
    "8302-2": {"variable": "HEIGHT", "label": "Body Height", "domain": "VS", "unit": "cm"},
    "8480-6": {"variable": "SYSBP", "label": "Systolic Blood Pressure", "domain": "VS", "unit": "mmHg"},
    "8462-4": {"variable": "DIABP", "label": "Diastolic Blood Pressure", "domain": "VS", "unit": "mmHg"},
    "8867-4": {"variable": "PULSE", "label": "Heart Rate", "domain": "VS", "unit": "beats/min"},
    "9279-1": {"variable": "RESP", "label": "Respiratory Rate", "domain": "VS", "unit": "breaths/min"},
    "59408-5": {"variable": "SPO2", "label": "Oxygen Saturation", "domain": "VS", "unit": "%"},
    "9843-4": {"variable": "TEMP", "label": "Body Temperature", "domain": "VS", "unit": "C"},
    "2345-7": {"variable": "GLUC", "label": "Fasting Glucose", "domain": "LB", "unit": "mg/dL"},
    "4548-4": {"variable": "HBA1C", "label": "Hemoglobin A1c", "domain": "LB", "unit": "%"},
    "33914-3": {"variable": "HGB", "label": "Hemoglobin", "domain": "LB", "unit": "g/dL"},
    "2951-2": {"variable": "SODIUM", "label": "Sodium (Serum)", "domain": "LB", "unit": "mmol/L"},
    "17861-6": {"variable": "CA", "label": "Calcium (Serum)", "domain": "LB", "unit": "mg/dL"},
    "1742-6": {"variable": "ALT", "label": "Alanine Aminotransferase", "domain": "LB", "unit": "U/L"},
    "771-6": {"variable": "AST", "label": "Aspartate Aminotransferase", "domain": "LB", "unit": "U/L"},
}

AYUSH_EXT_MARKER = "ayurveda/clinical-diagnostics"


def normalize_ucum(loinc: str, value: float, unit: str) -> tuple[float, str, str | None]:
    """UCUM normalisation to CDISC standard units; returns (value, unit, note)."""
    if loinc == "29463-7" and unit in ("lb", "[lb_av]"):
        return round(value * 0.45359237, 2), "kg", f"UCUM: {value} lb x 0.45359237 -> kg"
    if loinc == "8302-2" and unit in ("in", "[in_i]"):
        return round(value * 2.54, 1), "cm", f"UCUM: {value} in x 2.54 -> cm"
    if loinc == "9843-4" and unit in ("F", "[degF]"):
        return round((value - 32) / 1.8, 1), "C", f"UCUM: {value} degF -> degC"
    return value, unit, None


def validate_bundle_structure(bundle: dict) -> list[str]:
    """HAPI FHIR $validate stand-in: structural conformance of the Bundle."""
    errors: list[str] = []
    if bundle.get("resourceType") != "Bundle":
        errors.append("resourceType must be 'Bundle'")
    entries = bundle.get("entry")
    if not isinstance(entries, list) or not entries:
        errors.append("Bundle.entry must be a non-empty array")
        return errors
    has_patient = False
    for entry in entries:
        resource = entry.get("resource", {})
        rtype = resource.get("resourceType")
        if rtype == "Patient" and resource.get("id"):
            has_patient = True
        if rtype == "Observation":
            code = resource.get("code", {})
            if not code.get("coding"):
                errors.append("Observation.code.coding missing")
    if not has_patient:
        errors.append("Missing Patient Resource in FHIR bundle")
    return errors


def translate_fhir_to_sdtm(bundle: dict) -> dict | None:
    """Returns {participant_id, sdtm_rows, crf} or None when no Patient exists."""
    patient = None
    observations = []
    for entry in bundle.get("entry", []):
        resource = entry.get("resource", {})
        rtype = resource.get("resourceType")
        if rtype == "Patient":
            patient = resource
        elif rtype == "Observation":
            observations.append(resource)
    if not patient:
        return None
    participant_id = str(patient["id"])

    sdtm_rows: list[dict] = []
    for obs in observations:
        for coding in obs.get("code", {}).get("coding", []):
            system = coding.get("system", "")
            code = coding.get("code", "")
            if "loinc.org" not in system:
                continue
            spec = LOINC_SDTM.get(code)
            if not spec:
                continue
            if "valueQuantity" in obs:
                vq = obs["valueQuantity"]
                raw_value = float(vq.get("value", 0))
                raw_unit = vq.get("unit", spec["unit"])
                value, unit, note = normalize_ucum(code, raw_value, raw_unit)
                sdtm_rows.append({
                    "domain": spec["domain"],
                    "variable": spec["variable"],
                    "value": str(value),
                    "unit": unit,
                    "loinc": code,
                    "transformed": note,
                })

    crf = None
    for obs in observations:
        for ext in obs.get("extension", []):
            if AYUSH_EXT_MARKER not in ext.get("url", ""):
                continue
            diag = ext.get("valueObject", {})
            prakriti = diag.get("prakriti", {})
            crf = {
                "participant_id": participant_id,
                "visit_number": int(obs.get("visitNumber", 1)),
                "recorded_at": datetime.utcnow().isoformat() + "Z",
                "ayurvedic_variables": {
                    "prakriti": {
                        "primary_dosha": prakriti.get("primary", "Vata"),
                        "secondary_dosha": prakriti.get("secondary", "None"),
                        "semi_quantitative_score": float(prakriti.get("score", 0)),
                    },
                    "agni": {"metabolic_state": diag.get("agni", {}).get("state", "Sama")},
                    "koshtha": {"motility_state": diag.get("koshtha", {}).get("state", "Madhyama")},
                },
            }
    return {"participant_id": participant_id, "sdtm_rows": sdtm_rows, "crf": crf}
