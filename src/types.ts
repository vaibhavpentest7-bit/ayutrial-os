// ─── AyuTrial-OS domain model ────────────────────────────────────────────────
// Mirrors the production schema (db/postgres_init.sql, db/mongo_init.js) from
// the system design: relational SDTM observations in PostgreSQL, qualitative
// Ayurvedic CRF documents in MongoDB, KMS-signed consent tokens per DPDP 2023.

export type Dosha = "Vata" | "Pitta" | "Kapha";
export type AgniState = "Manda" | "Teekshna" | "Vishama" | "Sama";
export type KoshthaState = "Mridu" | "Madhyama" | "Kroora";

export type ConsentTier = "T1_PRIMARY" | "T2_SECONDARY" | "T3_GENOMIC";

export const CONSENT_TIERS: Record<ConsentTier, string> = {
  T1_PRIMARY: "T1 · Primary Care Data",
  T2_SECONDARY: "T2 · Secondary Research Use",
  T3_GENOMIC: "T3 · Genomic / Biobank",
};

export interface ConsentToken {
  tokenId: string;
  participantId: string;
  tier: ConsentTier;
  kmsKeyVersion: string;
  tokenSignature: string;
  isActive: boolean;
  grantedAt: string;
  revokedAt?: string;
}

export type ParticipantStatus =
  | "SCREENING"
  | "ACTIVE"
  | "COMPLETED"
  | "WITHDRAWN"
  | "LOCKED";

export interface Participant {
  participantId: string;
  abhaId: string;
  piiPurged?: boolean;
  trialId: string;
  site: string;
  age: number;
  sex: "M" | "F";
  enrolledAt: string;
  status: ParticipantStatus;
  ayurvedicProfile: {
    prakriti: { primary: Dosha; secondary: Dosha | "None"; score: number };
    agni: AgniState;
    koshtha: KoshthaState;
  };
}

export interface Trial {
  id: string;
  protocolCode: string;
  title: string;
  formulation: string;
  phase: "II" | "III";
  status: "RECRUITING" | "ACTIVE_NOT_RECRUITING" | "ANALYSIS";
  cdscoApproval: string;
  pi: string;
  sites: { name: string; city: string; enrolled: number; target: number }[];
  target: number;
  primaryEndpoint: string;
}

export type SdtmDomain = "DM" | "VS" | "LB";

export interface SdtmObservation {
  observationId: string;
  participantId: string;
  domain: SdtmDomain;
  variable: string;
  value: string;
  unit?: string;
  recordedAt: string;
  auditUserId: string;
  locked?: boolean;
}

export interface AyurvedicCrfDocument {
  id: string;
  participantId: string;
  visitNumber: number;
  recordedAt: string;
  variables: {
    prakriti: { primary_dosha: Dosha; secondary_dosha: Dosha | "None"; semi_quantitative_score: number };
    agni: { metabolic_state: AgniState };
    koshtha: { motility_state: KoshthaState };
  };
}

export type Ct04Status = "DRAFT" | "QUEUED" | "SUBMITTED";

export interface AdverseEvent {
  aeId: string;
  participantId: string;
  trialId: string;
  formulation: string;
  note: string;
  extractedTerm: string | null;
  icScore: number | null;
  severity: "MILD" | "MODERATE" | "SEVERE";
  detectedAt: string;
  ct04: {
    status: Ct04Status;
    submittedAt?: string;
    deadline: string; // 24-hour NDCT mandate window
  } | null;
}

export interface ActivityEntry {
  id: string;
  at: string;
  actor: string;
  text: string;
  kind: "ingest" | "consent" | "safety" | "lock" | "system";
}

export interface PlatformState {
  trials: Trial[];
  participants: Participant[];
  consentTokens: ConsentToken[];
  observations: SdtmObservation[];
  crfDocuments: AyurvedicCrfDocument[];
  adverseEvents: AdverseEvent[];
  activity: ActivityEntry[];
}
