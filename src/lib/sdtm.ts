// ─── AyuBridge core: HL7 FHIR → CDISC SDTM translation engine ───────────────
// Functional port of ayubridge/mapping/fhir_parser.py from the system design.
// Normalises LOINC-coded observations and UCUM units into SDTM variables, and
// extracts the Ministry of Ayush clinical-diagnostics extension into the
// Ayurvedic CRF document shape stored in MongoDB.

import type { AyurvedicCrfDocument, SdtmDomain } from "../types";

export interface SdtmVariableRow {
  domain: SdtmDomain;
  variable: string;
  value: string;
  unit?: string;
  loinc?: string;
  transformed?: string; // human-readable normalisation note
}

export interface MappingResult {
  participantId: string;
  sdtmRows: SdtmVariableRow[];
  crf: Omit<AyurvedicCrfDocument, "id"> | null;
}

/** LOINC → SDTM variable dictionary (VS/LB domains, per CDISC SDTMIG). */
export const LOINC_SDTM: Record<
  string,
  { variable: string; label: string; domain: SdtmDomain; unit: string }
> = {
  "29463-7": { variable: "WEIGHT", label: "Body Weight", domain: "VS", unit: "kg" },
  "8302-2": { variable: "HEIGHT", label: "Body Height", domain: "VS", unit: "cm" },
  "8480-6": { variable: "SYSBP", label: "Systolic Blood Pressure", domain: "VS", unit: "mmHg" },
  "8462-4": { variable: "DIABP", label: "Diastolic Blood Pressure", domain: "VS", unit: "mmHg" },
  "8867-4": { variable: "PULSE", label: "Heart Rate", domain: "VS", unit: "beats/min" },
  "9279-1": { variable: "RESP", label: "Respiratory Rate", domain: "VS", unit: "breaths/min" },
  "59408-5": { variable: "SPO2", label: "Oxygen Saturation", domain: "VS", unit: "%" },
  "9843-4": { variable: "TEMP", label: "Body Temperature", domain: "VS", unit: "C" },
  "2345-7": { variable: "GLUC", label: "Fasting Glucose", domain: "LB", unit: "mg/dL" },
  "4548-4": { variable: "HBA1C", label: "Hemoglobin A1c", domain: "LB", unit: "%" },
  "33914-3": { variable: "HGB", label: "Hemoglobin", domain: "LB", unit: "g/dL" },
  "2951-2": { variable: "SODIUM", label: "Sodium (Serum)", domain: "LB", unit: "mmol/L" },
  "17861-6": { variable: "CA", label: "Calcium (Serum)", domain: "LB", unit: "mg/dL" },
  "1742-6": { variable: "ALT", label: "Alanine Aminotransferase", domain: "LB", unit: "U/L" },
  "771-6": { variable: "AST", label: "Aspartate Aminotransferase", domain: "LB", unit: "U/L" },
};

/** UCUM normalisation — converts common EMR units to CDISC standard units. */
export function normalizeUcum(
  loinc: string,
  value: number,
  unit: string
): { value: number; unit: string; note?: string } {
  if (loinc === "29463-7" && (unit === "lb" || unit === "[lb_av]")) {
    return {
      value: Math.round(value * 0.45359237 * 100) / 100,
      unit: "kg",
      note: `UCUM: ${value} lb × 0.45359237 → kg`,
    };
  }
  if (loinc === "8302-2" && (unit === "in" || unit === "[in_i]")) {
    return {
      value: Math.round(value * 2.54 * 10) / 10,
      unit: "cm",
      note: `UCUM: ${value} in × 2.54 → cm`,
    };
  }
  if (loinc === "9843-4" && (unit === "F" || unit === "[degF]")) {
    return {
      value: Math.round(((value - 32) / 1.8) * 10) / 10,
      unit: "C",
      note: `UCUM: ${value} °F → °C`,
    };
  }
  return { value, unit };
}

export interface FhirBundle {
  resourceType: string;
  type?: string;
  entry: { resource: Record<string, any> }[];
}

/**
 * translate_fhir_to_sdtm — demultiplexes the EMR bundle, maps LOINC-coded
 * Observations to SDTM VS/LB variables and lifts the Ayush extension into the
 * qualitative Ayurvedic CRF document.
 */
export function translateFhirToSdtm(bundle: FhirBundle): MappingResult | null {
  let patient: Record<string, any> | null = null;
  const observations: Record<string, any>[] = [];

  for (const entry of bundle.entry ?? []) {
    const r = entry.resource;
    if (!r) continue;
    if (r.resourceType === "Patient") patient = r;
    if (r.resourceType === "Observation") observations.push(r);
  }
  if (!patient) return null;
  const participantId = String(patient.id);

  const sdtmRows: SdtmVariableRow[] = [];
  for (const obs of observations) {
    const codings: Record<string, any>[] = obs.code?.coding ?? [];
    for (const coding of codings) {
      const system: string = coding.system ?? "";
      const code: string = coding.code ?? "";
      if (!system.includes("loinc.org")) continue;
      const dict = LOINC_SDTM[code];
      if (!dict) continue;

      if (obs.valueQuantity) {
        const raw: number = obs.valueQuantity.value;
        const rawUnit: string = obs.valueQuantity.unit ?? dict.unit;
        const norm = normalizeUcum(code, raw, rawUnit);
        sdtmRows.push({
          domain: dict.domain,
          variable: dict.variable,
          value: String(norm.value),
          unit: norm.unit,
          loinc: code,
          transformed: norm.note,
        });
      } else if (obs.valueCodeableConcept) {
        sdtmRows.push({
          domain: dict.domain,
          variable: dict.variable,
          value: obs.valueCodeableConcept.text ?? "recorded",
          loinc: code,
        });
      }
    }
  }

  // Ayush extension → Ayurvedic CRF (MongoDB document)
  let crf: MappingResult["crf"] = null;
  for (const obs of observations) {
    for (const ext of obs.extension ?? []) {
      if (!(ext.url ?? "").includes("ayurveda/clinical-diagnostics")) continue;
      const d = ext.valueObject ?? ext.valueString ?? {};
      const diag = typeof d === "string" ? null : d;
      if (!diag) continue;
      crf = {
        participantId,
        visitNumber: obs.visitNumber ?? 1,
        recordedAt: new Date().toISOString(),
        variables: {
          prakriti: {
            primary_dosha: diag.prakriti?.primary ?? "Vata",
            secondary_dosha: diag.prakriti?.secondary ?? "None",
            semi_quantitative_score: Number(diag.prakriti?.score ?? 0),
          },
          agni: { metabolic_state: diag.agni?.state ?? "Sama" },
          koshtha: { motility_state: diag.koshtha?.state ?? "Madhyama" },
        },
      };
    }
  }

  return { participantId, sdtmRows, crf };
}
