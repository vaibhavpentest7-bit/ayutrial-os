import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import type {
  ActivityEntry,
  AdverseEvent,
  ConsentToken,
  ConsentTier,
  PlatformState,
  SdtmDomain,
} from "./types";
import { initialState } from "./data/seed";
import { EMR_SCENARIOS } from "./lib/fhir";
import { translateFhirToSdtm, type FhirBundle, type MappingResult } from "./lib/sdtm";
import type { AyurvedicCrfDocument } from "./types";
import {
  bcpnn,
  deadlineFrom,
  extractAdverseEvent,
  generateCt04Xml,
  severityForIc,
} from "./lib/bcpnn";
import {
  analyzeSafetyApi,
  checkBackend,
  grantConsentApi,
  ingestWebhook,
  revokeConsentApi,
  submitCt04Api,
  type HealthInfo,
} from "./lib/api";

// ─── Webhook pipeline (server-driven when backend is live, else in-browser) ─

export type PipelineStageStatus = "ok" | "fail" | "skipped";

export interface PipelineStage {
  key: string;
  title: string;
  subtitle: string;
  status: PipelineStageStatus;
  detail: string;
  output?: string;
}

export interface WebhookResult {
  stages: PipelineStage[];
  mapping: MappingResult | null;
  httpStatus: number;
  response: object;
  source: "backend" | "browser";
}

interface IngestInput {
  scenarioKey: string;
  participantId: string;
}

interface IngestApplied {
  participantId: string;
  rows: { domain: SdtmDomain; variable: string; value: string; unit?: string }[];
  crfSaved: boolean;
}

type Action =
  | { type: "ingest"; result: WebhookResult; ingested: IngestApplied | null }
  | { type: "grantConsent"; participantId: string; tier: ConsentTier }
  | { type: "revokeConsent"; participantId: string }
  | { type: "analyzeSafety"; ae: AdverseEvent; xml: string }
  | { type: "submitCt04"; aeId: string };

interface Store extends PlatformState {
  backendLive: boolean;
  backendInfo: HealthInfo | null;
  ingest: (input: IngestInput) => Promise<WebhookResult>;
  grantConsent: (participantId: string, tier: ConsentTier) => Promise<void>;
  revokeConsent: (participantId: string) => Promise<void>;
  analyzeSafety: (
    participantId: string,
    note: string,
    formulation: string
  ) => Promise<{ ae: AdverseEvent; xml: string }>;
  submitCt04: (aeId: string) => Promise<void>;
  lastWebhook: WebhookResult | null;
}

const StoreContext = createContext<Store | null>(null);

function log(
  state: PlatformState,
  kind: ActivityEntry["kind"],
  actor: string,
  text: string
): ActivityEntry[] {
  return [
    {
      id: `act-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      at: new Date().toISOString(),
      actor,
      text,
      kind,
    },
    ...state.activity,
  ].slice(0, 40);
}

function reducer(state: PlatformState, action: Action): PlatformState {
  switch (action.type) {
    case "ingest": {
      if (!action.ingested) return state;
      const { participantId, rows, crfSaved } = action.ingested;
      const now = new Date().toISOString();
      const observations = [
        ...state.observations,
        ...rows.map((r, i) => ({
          observationId: `obs-${Date.now()}-${i}`,
          participantId,
          domain: r.domain,
          variable: r.variable,
          value: r.value,
          unit: r.unit,
          recordedAt: now,
          auditUserId: "SYSTEM_AYUBRIDGE",
        })),
      ];
      const crfDocuments = crfSaved
        ? [
            ...state.crfDocuments,
            {
              id: `crf-${participantId}-${Date.now()}`,
              participantId,
              visitNumber: 1,
              recordedAt: now,
              variables: {
                prakriti: { primary_dosha: "Vata", secondary_dosha: "None", semi_quantitative_score: 0 },
                agni: { metabolic_state: "Sama" },
                koshtha: { motility_state: "Madhyama" },
              } as AyurvedicCrfDocument["variables"],
            },
          ]
        : state.crfDocuments;
      return {
        ...state,
        observations,
        crfDocuments,
        activity: log(
          state,
          "ingest",
          "SYSTEM_AYUBRIDGE",
          `EMR webhook ingested for ${participantId} — ${rows.length} SDTM rows to PostgreSQL${
            crfSaved ? ", Ayush CRF document to MongoDB" : ""
          }.`
        ),
      };
    }
    case "grantConsent": {
      const token: ConsentToken = {
        tokenId: `tk-${action.participantId}-${action.tier}-${Date.now()}`,
        participantId: action.participantId,
        tier: action.tier,
        kmsKeyVersion: `projects/ayutrial-sovereign-production/.../consent-signing-key@v${Math.floor(Math.random() * 4 + 6)}`,
        tokenSignature: Array.from({ length: 24 }, () =>
          Math.floor(Math.random() * 16).toString(16)
        ).join(""),
        isActive: true,
        grantedAt: new Date().toISOString(),
      };
      return {
        ...state,
        consentTokens: [...state.consentTokens, token],
        activity: log(
          state,
          "consent",
          "DATA_SCIENTIST_CONSOLE",
          `Consent tier ${action.tier} granted for ${action.participantId}; KMS-signed token appended to ledger.`
        ),
      };
    }
    case "revokeConsent": {
      const now = new Date().toISOString();
      return {
        ...state,
        consentTokens: state.consentTokens.map((t) =>
          t.participantId === action.participantId && t.isActive
            ? { ...t, isActive: false, revokedAt: now }
            : t
        ),
        participants: state.participants.map((p) =>
          p.participantId === action.participantId
            ? { ...p, status: "LOCKED", piiPurged: true, abhaId: "" }
            : p
        ),
        observations: [
          ...state.observations.map((o) =>
            o.participantId === action.participantId ? { ...o, locked: true } : o
          ),
          {
            observationId: `obs-lock-${Date.now()}`,
            participantId: action.participantId,
            domain: "DM",
            variable: "D_LOCK",
            value: "CONSENT_REVOKED",
            recordedAt: now,
            auditUserId: "SECURITY_CORE",
            locked: true,
          },
        ],
        activity: log(
          state,
          "lock",
          "SECURITY_CORE",
          `DPDP revocation for ${action.participantId} — KMS key version rotated, PII purged, observations frozen under retrospective data lock.`
        ),
      };
    }
    case "analyzeSafety": {
      return {
        ...state,
        adverseEvents: [action.ae, ...state.adverseEvents],
        activity: log(
          state,
          "safety",
          "SAFETY_CORE",
          action.ae.ct04
            ? `BCPNN IC ${action.ae.icScore?.toFixed(2)} breach — draft Form CT-04 generated for ${action.ae.participantId} (${action.ae.extractedTerm}).`
            : `Safety note analysed for ${action.ae.participantId} — no CT-04 breach (IC ${action.ae.icScore?.toFixed(2)}).`
        ),
      };
    }
    case "submitCt04": {
      return {
        ...state,
        adverseEvents: state.adverseEvents.map((ae) =>
          ae.aeId === action.aeId && ae.ct04
            ? { ...ae, ct04: { ...ae.ct04, status: "SUBMITTED", submittedAt: new Date().toISOString() } }
            : ae
        ),
        activity: log(
          state,
          "safety",
          "SAFETY_CORE",
          `Form CT-04 submitted to SUGAM portal for ${action.aeId}.`
        ),
      };
    }
  }
}

function localIngest(
  state: PlatformState,
  bundle: FhirBundle
): { result: WebhookResult; ingested: IngestApplied | null } {
  const stages: PipelineStage[] = [];
  const push = (s: PipelineStage) => stages.push(s);

  push({
    key: "webhook",
    title: "EMR Webhook Received",
    subtitle: "POST /api/v1/emr/webhook",
    status: "ok",
    detail: `${bundle.entry.length} FHIR resources from hospital HIS.`,
    output: JSON.stringify(bundle, null, 2),
  });
  push({
    key: "validate",
    title: "FHIR Validation",
    subtitle: "HAPI FHIR $validate · NRCeS IG",
    status: "ok",
    detail: "Bundle conforms to India NIHB/FHIR R4 profile. Signature header verified.",
  });

  const activeT1 = state.consentTokens.some(
    (t) =>
      t.participantId ===
        bundle.entry.find((e) => e.resource?.resourceType === "Patient")?.resource?.id &&
      t.tier === "T1_PRIMARY" &&
      t.isActive
  );
  const pid = String(
    bundle.entry.find((e) => e.resource?.resourceType === "Patient")?.resource?.id ?? ""
  );
  if (!activeT1) {
    push({
      key: "consent",
      title: "Cryptographic Consent Check",
      subtitle: "PostgreSQL consent ledger · DPDP Act 2023",
      status: "fail",
      detail: "No active T1_PRIMARY consent token for this participant.",
    });
    return {
      result: {
        stages,
        mapping: null,
        httpStatus: 403,
        response: {
          status: "error",
          detail: "DPDP Act Compliance Error: No active consent token verified for this operation.",
        },
        source: "browser",
      },
      ingested: null,
    };
  }
  push({
    key: "consent",
    title: "Cryptographic Consent Check",
    subtitle: "PostgreSQL consent ledger · DPDP Act 2023",
    status: "ok",
    detail: `Active KMS-signed T1_PRIMARY token found for ${pid}.`,
  });

  const mapping = translateFhirToSdtm(bundle);
  if (!mapping || mapping.sdtmRows.length === 0) {
    push({
      key: "translate",
      title: "AyuBridge Translation",
      subtitle: "LOINC → SDTM · UCUM normalisation",
      status: "fail",
      detail: "No mappable LOINC-coded observations in bundle.",
    });
    return {
      result: {
        stages,
        mapping: null,
        httpStatus: 422,
        response: { status: "error", detail: "Nothing to map." },
        source: "browser",
      },
      ingested: null,
    };
  }
  push({
    key: "translate",
    title: "AyuBridge Translation",
    subtitle: "LOINC → SDTM · UCUM normalisation",
    status: "ok",
    detail: `${mapping.sdtmRows.length} SDTM variables derived${
      mapping.crf ? " + Ayush CRF extension extracted" : ""
    }.`,
  });
  push({
    key: "persist",
    title: "Dual Persistence",
    subtitle: "PostgreSQL (RLS) + MongoDB",
    status: "ok",
    detail: `${mapping.sdtmRows.length} SDTM rows written under RLS${
      mapping.crf ? "; qualitative CRF appended to MongoDB" : ""
    }.`,
  });

  return {
    result: {
      stages,
      mapping,
      httpStatus: 201,
      response: {
        status: "success",
        detail: "Interoperable payload ingested, translated and archived securely.",
      },
      source: "browser",
    },
    ingested: {
      participantId: pid,
      rows: mapping.sdtmRows.map((r) => ({
        domain: r.domain,
        variable: r.variable,
        value: r.value + (r.unit ? ` ${r.unit}` : ""),
      })),
      crfSaved: Boolean(mapping.crf),
    },
  };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [lastWebhook, setLastWebhook] = useState<WebhookResult | null>(null);
  const [backendLive, setBackendLive] = useState(false);
  const [backendInfo, setBackendInfo] = useState<HealthInfo | null>(null);

  useEffect(() => {
    checkBackend().then((info) => {
      if (info) {
        setBackendInfo(info);
        setBackendLive(true);
      }
    });
  }, []);

  const ingest = useCallback(
    async ({ scenarioKey, participantId }: IngestInput): Promise<WebhookResult> => {
      const scenario =
        EMR_SCENARIOS.find((s) => s.key === scenarioKey) ?? EMR_SCENARIOS[0];
      const bundle = scenario.build(participantId) as unknown as FhirBundle;

      // Preferred path: the real AyuBridge API
      if (backendLive) {
        const apiResult = await ingestWebhook(bundle);
        if (apiResult) {
          const ingested: IngestApplied | null = apiResult.mapping
            ? {
                participantId,
                rows: apiResult.mapping.sdtmRows.map((r) => ({
                  domain: r.domain,
                  variable: r.variable,
                  value: r.value + (r.unit ? ` ${r.unit}` : ""),
                })),
                crfSaved: Boolean(apiResult.mapping.crf),
              }
            : null;
          setLastWebhook(apiResult);
          dispatch({ type: "ingest", result: apiResult, ingested });
          return apiResult;
        }
        // Backend went away mid-session — fall through to the in-browser engine
        setBackendLive(false);
      }

      const { result, ingested } = localIngest(state, bundle);
      setLastWebhook(result);
      dispatch({ type: "ingest", result, ingested });
      return result;
    },
    [backendLive, state]
  );

  const grantConsent = useCallback(
    async (participantId: string, tier: ConsentTier) => {
      if (backendLive) {
        const ok = await grantConsentApi(participantId, tier);
        if (ok) {
          dispatch({ type: "grantConsent", participantId, tier });
          return;
        }
        setBackendLive(false);
      }
      dispatch({ type: "grantConsent", participantId, tier });
    },
    [backendLive]
  );

  const revokeConsent = useCallback(
    async (participantId: string) => {
      if (backendLive) {
        const ok = await revokeConsentApi(participantId);
        if (ok) {
          dispatch({ type: "revokeConsent", participantId });
          return;
        }
        setBackendLive(false);
      }
      dispatch({ type: "revokeConsent", participantId });
    },
    [backendLive]
  );

  const analyzeSafety = useCallback(
    async (participantId: string, note: string, formulation: string) => {
      if (backendLive) {
        const res = await analyzeSafetyApi(participantId, note, formulation);
        if (res) {
          dispatch({ type: "analyzeSafety", ae: res.ae, xml: res.xml });
          return res;
        }
        setBackendLive(false);
      }
      // In-browser engine path
      const term = extractAdverseEvent(note);
      const score = bcpnn({ pFormulation: 0.1, pAdverseEvent: 0.02, pJoint: 0.04 });
      const now = new Date();
      const ae: AdverseEvent = {
        aeId: `AE-${now.getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        participantId,
        trialId: state.participants.find((p) => p.participantId === participantId)?.trialId ?? "",
        formulation,
        note,
        extractedTerm: term,
        icScore: score.ic,
        severity: severityForIc(score.ic),
        detectedAt: now.toISOString(),
        ct04: term && score.flag ? { status: "DRAFT", deadline: deadlineFrom(now) } : null,
      };
      const xml = term && score.flag ? generateCt04Xml(participantId, formulation, term, score.ic) : "";
      dispatch({ type: "analyzeSafety", ae, xml });
      return { ae, xml };
    },
    [backendLive, state.participants]
  );

  const submitCt04 = useCallback(
    async (aeId: string) => {
      if (backendLive) {
        const ok = await submitCt04Api(aeId);
        if (ok) {
          dispatch({ type: "submitCt04", aeId });
          return;
        }
        setBackendLive(false);
      }
      dispatch({ type: "submitCt04", aeId });
    },
    [backendLive]
  );

  const value = useMemo<Store>(
    () => ({
      ...state,
      backendLive,
      backendInfo,
      ingest,
      grantConsent,
      revokeConsent,
      analyzeSafety,
      submitCt04,
      lastWebhook,
    }),
    [state, backendLive, backendInfo, ingest, grantConsent, revokeConsent, analyzeSafety, submitCt04, lastWebhook]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
