// ─── Seeded demo dataset ────────────────────────────────────────────────────
// Deterministic pseudo-random generation so every demo run shows the same
// study population. Trial themes mirror real Ministry of Ayush research
// priorities (Ashwagandha post-COVID recovery, multi-herbal obesity regimen,
// Amalaki metabolic study).

import type {
  ActivityEntry,
  AdverseEvent,
  AyurvedicCrfDocument,
  ConsentToken,
  Participant,
  PlatformState,
  SdtmObservation,
  Trial,
} from "../types";
import { randomDoshaTriplet } from "../lib/fhir";

// Deterministic PRNG (mulberry32)
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = prng(20260925);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const uuid = (() => {
  let n = 0;
  return () => `p-${(++n).toString().padStart(3, "0")}-${Math.floor(rand() * 1e6).toString(16)}`;
})();

export const SITES = [
  { name: "AIIA New Delhi", city: "New Delhi" },
  { name: "IPGT&RA Jamnagar", city: "Jamnagar" },
  { name: "NIA Jaipur", city: "Jaipur" },
  { name: "RAGU Govt. Ayurveda College", city: "Thiruvananthapuram" },
];

const FIRST = [
  "Aarav", "Diya", "Ishaan", "Kavya", "Rohan", "Ananya", "Vikram", "Meera",
  "Arjun", "Sneha", "Karthik", "Pooja", "Dev", "Riya", "Aditya", "Nisha",
  "Manav", "Tanvi", "Siddharth", "Lakshmi",
];
const LAST = [
  "Sharma", "Patel", "Nair", "Iyer", "Gupta", "Reddy", "Joshi", "Menon",
  "Verma", "Desai", "Kulkarni", "Bhat",
];

export const TRIALS: Trial[] = [
  {
    id: "t-ashwagandha",
    protocolCode: "AYU-RCT-2026-014",
    title:
      "Efficacy of Ashwagandha Ghan Vati in promoting recovery from post-COVID fatigue syndrome",
    formulation: "Ashwagandha Ghan Vati",
    phase: "III",
    status: "ACTIVE_NOT_RECRUITING",
    cdscoApproval: "CT/AYU/2026/014-III",
    pi: "Prof. S. Kotwal",
    sites: SITES.slice(0, 3).map((s, i) => ({
      ...s,
      enrolled: [96, 74, 52][i],
      target: [110, 90, 70][i],
    })),
    target: 270,
    primaryEndpoint: "Change in WHO-Fatigue Scale at Week 8",
  },
  {
    id: "t-obesity",
    protocolCode: "AYU-RCT-2026-021",
    title:
      "Multi-herbal formulation (Triphala Guggulu + Mustak) in management of Sthaulya (obesity)",
    formulation: "Triphala Guggulu-Mustak Yoga",
    phase: "II",
    status: "RECRUITING",
    cdscoApproval: "CT/AYU/2026/021-II",
    pi: "Dr. A. Bhagwat",
    sites: SITES.map((s, i) => ({
      ...s,
      enrolled: [41, 33, 27, 19][i],
      target: [50, 45, 40, 35][i],
    })),
    target: 170,
    primaryEndpoint: "BMI reduction and Agni normalisation at Week 12",
  },
  {
    id: "t-amalaki",
    protocolCode: "AYU-RCT-2025-008",
    title: "Amalaki Rasayana as adjunct therapy in pre-diabetes (Prameha Poorvaroopa)",
    formulation: "Amalaki Rasayana",
    phase: "II",
    status: "ANALYSIS",
    cdscoApproval: "CT/AYU/2025/008-II",
    pi: "Dr. M. Krishnan",
    sites: SITES.slice(1, 3).map((s, i) => ({
      ...s,
      enrolled: [60, 58][i],
      target: [60, 60][i],
    })),
    target: 120,
    primaryEndpoint: "HbA1c trajectory over 24 weeks",
  },
];

function makeAbha(): string {
  return `14-${int(1000, 9999)}-${int(1000, 9999)}-${int(10, 99)}`;
}

function makeParticipants(): {
  participants: Participant[];
  tokens: ConsentToken[];
  crfs: AyurvedicCrfDocument[];
} {
  const participants: Participant[] = [];
  const tokens: ConsentToken[] = [];
  const crfs: AyurvedicCrfDocument[] = [];

  const plan: { trial: string; n: number; statuses: Participant["status"][] }[] = [
    { trial: "t-ashwagandha", n: 10, statuses: ["ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE", "COMPLETED", "ACTIVE", "SCREENING", "ACTIVE", "LOCKED"] },
    { trial: "t-obesity", n: 6, statuses: ["ACTIVE", "ACTIVE", "SCREENING", "ACTIVE", "WITHDRAWN", "ACTIVE"] },
    { trial: "t-amalaki", n: 4, statuses: ["COMPLETED", "COMPLETED", "COMPLETED", "ACTIVE"] },
  ];

  let idx = 0;
  for (const { trial, n, statuses } of plan) {
    for (let i = 0; i < n; i++) {
      idx += 1;
      const pid = `PT-${String(idx).padStart(4, "0")}`;
      const status = statuses[i];
      participants.push({
        participantId: pid,
        abhaId: makeAbha(),
        trialId: trial,
        site: pick(SITES).name,
        age: int(24, 62),
        sex: rand() > 0.45 ? "M" : "F",
        enrolledAt: new Date(Date.UTC(2026, int(2, 7), int(1, 27))).toISOString(),
        status,
        ayurvedicProfile: randomDoshaTriplet(),
      });

      // Consent tokens — most grant T1 + T2, a few T3; LOCKED participant is revoked
      const tiers: ("T1_PRIMARY" | "T2_SECONDARY" | "T3_GENOMIC")[] =
        status === "LOCKED" ? [] : rand() > 0.3 ? ["T1_PRIMARY", "T2_SECONDARY"] : ["T1_PRIMARY"];
      if (status !== "LOCKED" && rand() > 0.7) tiers.push("T3_GENOMIC");
      for (const tier of tiers) {
        tokens.push({
          tokenId: `tk-${pid}-${tier}`,
          participantId: pid,
          tier,
          kmsKeyVersion: `projects/ayutrial-sovereign-production/.../consent-signing-key@v${int(3, 7)}`,
          tokenSignature: Array.from({ length: 24 }, () =>
            Math.floor(rand() * 16).toString(16)
          ).join(""),
          isActive: true,
          grantedAt: participants[participants.length - 1].enrolledAt,
        });
      }
      if (status === "LOCKED") {
        tokens.push({
          tokenId: `tk-${pid}-T1_PRIMARY`,
          participantId: pid,
          tier: "T1_PRIMARY",
          kmsKeyVersion: "projects/ayutrial-sovereign-production/.../consent-signing-key@v9",
          tokenSignature: Array.from({ length: 24 }, () => Math.floor(rand() * 16).toString(16)).join(""),
          isActive: false,
          grantedAt: participants[participants.length - 1].enrolledAt,
          revokedAt: new Date(Date.UTC(2026, 7, 14)).toISOString(),
        });
      }

      // Ayurvedic CRF documents (MongoDB collection)
      if (status !== "SCREENING") {
        const prof = participants[participants.length - 1].ayurvedicProfile;
        crfs.push({
          id: `crf-${pid}-v${int(1, 4)}`,
          participantId: pid,
          visitNumber: int(1, 4),
          recordedAt: new Date(Date.UTC(2026, int(4, 8), int(1, 27))).toISOString(),
          variables: {
            prakriti: {
              primary_dosha: prof.prakriti.primary,
              secondary_dosha: prof.prakriti.secondary,
              semi_quantitative_score: prof.prakriti.score,
            },
            agni: { metabolic_state: prof.agni },
            koshtha: { motility_state: prof.koshtha },
          },
        });
      }
    }
  }
  return { participants, tokens, crfs };
}

const { participants, tokens, crfs } = makeParticipants();

function makeObservations(): SdtmObservation[] {
  const rows: SdtmObservation[] = [];
  let n = 0;
  const active = participants.filter((p) => p.status !== "SCREENING");
  for (const p of active) {
    const visits = int(2, 4);
    for (let v = 0; v < visits; v++) {
      const at = new Date(Date.UTC(2026, int(3, 8), int(1, 27), int(8, 16))).toISOString();
      const locked = p.status === "LOCKED";
      const mk = (domain: SdtmObservation["domain"], variable: string, value: string, unit?: string) => {
        n += 1;
        rows.push({
          observationId: `obs-${n.toString().padStart(5, "0")}`,
          participantId: p.participantId,
          domain,
          variable,
          value,
          unit,
          recordedAt: at,
          auditUserId: locked ? "SECURITY_CORE" : "SYSTEM_AYUBRIDGE",
          locked,
        });
      };
      mk("VS", "SYSBP", String(int(108, 138)), "mmHg");
      mk("VS", "DIABP", String(int(68, 88)), "mmHg");
      mk("VS", "PULSE", String(int(62, 92)), "beats/min");
      if (p.trialId === "t-obesity") mk("VS", "WEIGHT", String((int(6800, 10400) / 100).toFixed(2)), "kg");
      if (p.trialId === "t-amalaki") mk("LB", "HBA1C", (int(510, 640) / 100).toFixed(2), "%");
      if (p.trialId === "t-ashwagandha") mk("LB", "HGB", (int(110, 152) / 10).toFixed(1), "g/dL");
    }
  }
  // Data-lock marker appended by the consent revocation pipeline
  rows.push({
    observationId: "obs-lock-0001",
    participantId: "PT-0010",
    domain: "DM",
    variable: "D_LOCK",
    value: "CONSENT_REVOKED",
    recordedAt: new Date(Date.UTC(2026, 7, 14, 9, 41)).toISOString(),
    auditUserId: "SECURITY_CORE",
    locked: true,
  });
  return rows;
}

const observations = makeObservations();

function makeAes(): AdverseEvent[] {
  const base: AdverseEvent[] = [
    {
      aeId: "AE-2026-0031",
      participantId: "PT-0002",
      trialId: "t-ashwagandha",
      formulation: "Ashwagandha Ghan Vati",
      note:
        "Participant reported mild headache on day 4 of dosing, resolved without intervention. Continued per protocol.",
      extractedTerm: "Headache",
      icScore: 0.92,
      severity: "MILD",
      detectedAt: new Date(Date.UTC(2026, 6, 3, 10, 12)).toISOString(),
      ct04: null,
    },
    {
      aeId: "AE-2026-0044",
      participantId: "PT-0012",
      trialId: "t-obesity",
      formulation: "Triphala Guggulu-Mustak Yoga",
      note:
        "Loose motions x3 episodes after dose escalation to 500mg BD, managed with Panchakola, resolved in 48h.",
      extractedTerm: "Diarrhoea",
      icScore: 1.18,
      severity: "MILD",
      detectedAt: new Date(Date.UTC(2026, 6, 19, 8, 55)).toISOString(),
      ct04: null,
    },
    {
      aeId: "AE-2026-0051",
      participantId: "PT-0005",
      trialId: "t-ashwagandha",
      formulation: "Ashwagandha Ghan Vati",
      note:
        "Palpitations reported post-dose on visit 3, ECG shows sinus tachycardia 112/min. Drug withheld, cardiology review sought.",
      extractedTerm: "Palpitations",
      icScore: 2.31,
      severity: "MODERATE",
      detectedAt: new Date(Date.UTC(2026, 7, 2, 15, 30)).toISOString(),
      ct04: {
        status: "QUEUED",
        deadline: new Date(Date.UTC(2026, 8, 26, 15, 30)).toISOString(),
      },
    },
  ];
  return base;
}

const adverseEvents = makeAes();

const activity: ActivityEntry[] = [
  {
    id: "act-1",
    at: new Date(Date.UTC(2026, 8, 24, 9, 41)).toISOString(),
    actor: "SYSTEM_AYUBRIDGE",
    text: "FHIR bundle from AIIA HIS validated and mapped — 4 SDTM VS rows persisted (PT-0003, Visit 5).",
    kind: "ingest",
  },
  {
    id: "act-2",
    at: new Date(Date.UTC(2026, 8, 23, 16, 8)).toISOString(),
    actor: "DSC_JAMNAGAR",
    text: "Consent tier T3_GENOMIC granted for PT-0007; KMS-signed token appended to ledger.",
    kind: "consent",
  },
  {
    id: "act-3",
    at: new Date(Date.UTC(2026, 8, 22, 11, 2)).toISOString(),
    actor: "SAFETY_CORE",
    text: "BCPNN IC 2.31 breach — draft Form CT-04 queued for SUGAM submission (AE-2026-0051).",
    kind: "safety",
  },
  {
    id: "act-4",
    at: new Date(Date.UTC(2026, 7, 14, 9, 41)).toISOString(),
    actor: "SECURITY_CORE",
    text: "DPDP revocation processed for PT-0010 — KMS key rotated, PII purged, retrospective data lock enforced.",
    kind: "lock",
  },
];

export const initialState: PlatformState = {
  trials: TRIALS,
  participants,
  consentTokens: tokens,
  observations,
  crfDocuments: crfs,
  adverseEvents,
  activity,
};
