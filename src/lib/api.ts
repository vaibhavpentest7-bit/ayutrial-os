// ─── AyuBridge API client ───────────────────────────────────────────────────
// Talks to the FastAPI backend (backend/run.sh, port 8000). Every call degrades
// gracefully: when the backend is unreachable the store falls back to the
// identical in-browser engines, and the sidebar shows which mode is active.

import type { AdverseEvent, ConsentTier, SdtmDomain } from "../types";
import type { MappingResult, FhirBundle } from "./sdtm";
import type { WebhookResult, PipelineStage } from "../store";

const BASE = "http://localhost:8000";
const TIMEOUT_MS = 2500;

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface HealthInfo {
  status: string;
  service: string;
  kms_key: string;
  participants: number;
  sdtm_observations: number;
  crf_documents: number;
}

export async function checkBackend(): Promise<HealthInfo | null> {
  return call<HealthInfo>("/health");
}

// ── Response shape converters (snake_case API → camelCase store) ────────────

interface ApiStage {
  key: string;
  title: string;
  subtitle: string;
  status: string;
  detail: string;
}

interface ApiMapping {
  participant_id: string;
  sdtm_rows: {
    domain: string;
    variable: string;
    value: string;
    unit?: string;
    loinc?: string;
    transformed?: string | null;
  }[];
  crf: {
    participant_id: string;
    visit_number: number;
    recorded_at: string;
    ayurvedic_variables: {
      prakriti: { primary_dosha: string; secondary_dosha: string; semi_quantitative_score: number };
      agni: { metabolic_state: string };
      koshtha: { motility_state: string };
    };
  } | null;
}

function toMappingResult(api: ApiMapping): MappingResult {
  return {
    participantId: api.participant_id,
    sdtmRows: api.sdtm_rows.map((r) => ({
      domain: r.domain as SdtmDomain,
      variable: r.variable,
      value: r.value,
      unit: r.unit,
      loinc: r.loinc,
      transformed: r.transformed ?? undefined,
    })),
    // The backend emits identical Ayurvedic enum values (Vata/Pitta/Kapha,
    // Manda/Teekshna/Vishama/Sama, Mridu/Madhyama/Kroora) — one cast.
    crf: api.crf
      ? ({
          participantId: api.crf.participant_id,
          visitNumber: api.crf.visit_number,
          recordedAt: api.crf.recorded_at,
          variables: {
            prakriti: api.crf.ayurvedic_variables.prakriti,
            agni: api.crf.ayurvedic_variables.agni,
            koshtha: api.crf.ayurvedic_variables.koshtha,
          },
        } as MappingResult["crf"])
      : null,
  };
}

function toStages(api: ApiStage[]): PipelineStage[] {
  return api.map((s) => ({
    key: s.key,
    title: s.title,
    subtitle: s.subtitle,
    status: s.status as PipelineStage["status"],
    detail: s.detail,
  }));
}

// ── Endpoints ───────────────────────────────────────────────────────────────

export async function ingestWebhook(bundle: FhirBundle): Promise<WebhookResult | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS + 1500);
  try {
    const res = await fetch(`${BASE}/api/v1/emr/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bundle),
      signal: ctrl.signal,
    });
    const body = await res.json();
    // Success envelope: {stages, mapping, http_status, response}
    if (body.stages) {
      return {
        stages: toStages(body.stages),
        mapping: body.mapping ? toMappingResult(body.mapping) : null,
        httpStatus: body.http_status ?? res.status,
        response: body.response,
        source: "backend",
      };
    }
    // Error envelope from HTTPException: {detail: {stages, http_status, response}}
    if (body.detail?.stages) {
      return {
        stages: toStages(body.detail.stages),
        mapping: null,
        httpStatus: body.detail.http_status ?? res.status,
        response: body.detail.response,
        source: "backend",
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function grantConsentApi(
  participantId: string,
  tier: ConsentTier
): Promise<boolean> {
  const res = await call(`/api/v1/consent/${participantId}/grant`, {
    method: "POST",
    body: JSON.stringify({ tier }),
  });
  return res !== null;
}

export async function revokeConsentApi(participantId: string): Promise<boolean> {
  const res = await call(`/api/v1/consent/${participantId}/revoke`, { method: "POST" });
  return res !== null;
}

interface ApiAe {
  ae_id: string;
  participant_id: string;
  trial_id: string;
  formulation: string;
  note: string;
  extracted_term: string | null;
  bcpnn: { ic: number };
  severity: string;
  detected_at: string;
  ct04: { status: string; deadline: string; submitted_at: string | null } | null;
}

function toAdverseEvent(api: ApiAe): AdverseEvent {
  return {
    aeId: api.ae_id,
    participantId: api.participant_id,
    trialId: api.trial_id,
    formulation: api.formulation,
    note: api.note,
    extractedTerm: api.extracted_term,
    icScore: api.bcpnn?.ic ?? null,
    severity: api.severity as AdverseEvent["severity"],
    detectedAt: api.detected_at,
    ct04: api.ct04
      ? ({
          status: api.ct04.status,
          deadline: api.ct04.deadline,
          submittedAt: api.ct04.submitted_at ?? undefined,
        } as AdverseEvent["ct04"])
      : null,
  };
}

export async function analyzeSafetyApi(
  participantId: string,
  note: string,
  formulation: string
): Promise<{ ae: AdverseEvent; xml: string } | null> {
  const res = await call<{ ae: ApiAe; xml: string }>("/api/v1/safety/analyze", {
    method: "POST",
    body: JSON.stringify({ participant_id: participantId, note, formulation }),
  });
  if (!res) return null;
  return { ae: toAdverseEvent(res.ae), xml: res.xml };
}

export async function submitCt04Api(aeId: string): Promise<boolean> {
  const res = await call(`/api/v1/safety/ct04/${aeId}/submit`, { method: "POST" });
  return res !== null;
}
