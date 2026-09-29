// ─── AI Safety Core: BioBERT extraction (simulated) + BCPNN causality ───────
// Port of ayubridge/safety/causality.py and tasks.py. In production BioBERT
// runs on a local vLLM endpoint; the prototype ships a deterministic
// clinical-NER substitute so the pipeline is fully reproducible offline.

import type { AdverseEvent } from "../types";

/** Adverse-event lexicon for the deterministic extraction pass. */
const AE_LEXICON: { term: string; patterns: RegExp[] }[] = [
  { term: "Nausea", patterns: [/\bnausea\b/i, /\bfeel(?:ing)? sick\b/i, /\bqueasy\b/i] },
  { term: "Headache", patterns: [/\bheadache\b/i, /\bhead pain\b/i, /\bmigraine\b/i] },
  { term: "Dizziness", patterns: [/\bdizzin?ess\b/i, /\blightheadedn?ess\b/i, /\bvertigo\b/i] },
  { term: "Fatigue", patterns: [/\bfatigue\b/i, /\blethargy\b/i, /\bweakness\b/i, /\btiredn?ess\b/i] },
  { term: "Rash", patterns: [/\brash\b/i, /\bskin eruption\b/i, /\bur ticaria\b/i, /\burticaria\b/i] },
  { term: "Pruritus (Itching)", patterns: [/\bitch(?:ing)?\b/i, /\bpruritus\b/i] },
  { term: "Abdominal Pain", patterns: [/\babdominal pain\b/i, /\bstomach (?:pain|ache)\b/i, /\bcolic\b/i] },
  { term: "Diarrhoea", patterns: [/\bdiarr?hoe?a\b/i, /\bloose motions?\b/i] },
  { term: "Insomnia", patterns: [/\binsomnia\b/i, /\bsleeplessness\b/i, /\bcould not sleep\b/i] },
  { term: "Palpitations", patterns: [/\bpalpitations?\b/i, /\bracing heart\b/i] },
  { term: "Dry Mouth", patterns: [/\bdry mouth\b/i, /\bxerostomia\b/i] },
  { term: "Acid Reflux", patterns: [/\bacid reflux\b/i, /\bheartburn\b/i, /\bhyperacidity\b/i] },
];

/**
 * Simulated BioBERT NER: extracts the first adverse-event term from free text
 * clinician notes. Returns null when no signal is present.
 */
export function extractAdverseEvent(doctorNotes: string): string | null {
  for (const entry of AE_LEXICON) {
    for (const re of entry.patterns) {
      if (re.test(doctorNotes)) return entry.term;
    }
  }
  return null;
}

export interface BcpnnInput {
  pFormulation: number; // P(A): population exposure to the formulation
  pAdverseEvent: number; // P(B): background incidence of the event
  pJoint: number; // P(A,B): observed joint probability
}

export interface BcpnnResult {
  expected: number;
  observed: number;
  ic: number;
  signalStrength: number; // 0-100 normalised display scale
  flag: boolean; // IC > 1.5 ⇒ strong positive association → CT-04
}

/**
 * Bayesian Confidence Propagation Neural Network (BCPNN) — information
 * component as used by the WHO Uppsala Monitoring Centre:
 *   IC = log2( P(A,B) / (P(A) · P(B)) )
 * IC > 1.5 breaches the pharmacovigilance threshold and triggers the
 * mandatory CDSCO Form CT-04 serious-AE workflow (24-hour mandate).
 */
export function bcpnn(input: BcpnnInput): BcpnnResult {
  const expected = input.pFormulation * input.pAdverseEvent;
  const observed = input.pJoint;
  const ic =
    expected <= 0 || observed <= 0
      ? -Infinity
      : Math.log2(observed / expected);
  const signalStrength = Math.max(0, Math.min(100, Math.round(((ic + 2) / 6) * 100)));
  return {
    expected,
    observed,
    ic: Number(ic.toFixed(3)),
    signalStrength,
    flag: ic > 1.5,
  };
}

export const CT04_DEADLINE_HOURS = 24;

/** ISO timestamp `hours` ahead of `from`. */
export function deadlineFrom(from: Date, hours = CT04_DEADLINE_HOURS): string {
  return new Date(from.getTime() + hours * 3600_000).toISOString();
}

/** Compiles the CDSCO Form CT-04 XML draft for SUGAM portal submission. */
export function generateCt04Xml(
  participantId: string,
  formulationName: string,
  eventTerm: string,
  icScore: number
): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<CDSCO_Form_CT04_Report>
  <Header>
    <ReportType>SERIOUS_ADVERSE_EVENT_DUE_ANALYSIS</ReportType>
    <SubmissionTimestamp>${now}</SubmissionTimestamp>
    <RegulationAuthority>Central_Licensing_Authority_DCGI</RegulationAuthority>
    <Portal>SUGAM</Portal>
  </Header>
  <StudySubject>
    <ParticipantAnonymizedUUID>${participantId}</ParticipantAnonymizedUUID>
  </StudySubject>
  <SuspectTherapy>
    <FormulationName>${formulationName}</FormulationName>
    <BotanicalAFIReferencedCode>AFI_I_V8_${formulationName.split(" ")[0].toUpperCase()}</BotanicalAFIReferencedCode>
  </SuspectTherapy>
  <AdverseEvent>
    <ExtractedTerm>${eventTerm}</ExtractedTerm>
    <CausalityCriterion>Bayesian_Confidence_Propagation_Neural_Network</CausalityCriterion>
    <CausalityScoreIC>${icScore.toFixed(4)}</CausalityScoreIC>
    <ReportingUrgencyLevel>CRITICAL_24_HOUR_MANDATE</ReportingUrgencyLevel>
  </AdverseEvent>
</CDSCO_Form_CT04_Report>`;
}

export function severityForIc(ic: number): AdverseEvent["severity"] {
  if (ic > 3) return "SEVERE";
  if (ic > 1.5) return "MODERATE";
  return "MILD";
}
