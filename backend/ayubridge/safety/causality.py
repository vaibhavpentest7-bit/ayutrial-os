"""AI Safety Core — BioBERT extraction (local substitute) + BCPNN causality.

Production port of ayubridge/safety/causality.py and tasks.py: the extraction
hook keeps the exact async interface of the vLLM/BioBERT call; the causality
engine implements the Bayesian Confidence Propagation Neural Network
information component exactly as shipped, and CDSCO Form CT-04 XML compiles
for the SUGAM submission queue.
"""

import math
from datetime import datetime, timedelta, timezone

from .. import config

# Adverse-event lexicon for the deterministic extraction pass (offline stand-in
# for dmis-lab/biobert-v1.1 served from the local vLLM endpoint).
AE_LEXICON: list[tuple[str, list[str]]] = [
    ("Nausea", [r"\bnausea\b", r"\bfeel(?:ing)? sick\b", r"\bqueasy\b"]),
    ("Headache", [r"\bheadache\b", r"\bhead pain\b", r"\bmigraine\b"]),
    ("Dizziness", [r"\bdizzin?ess\b", r"\blightheadedn?ess\b", r"\bvertigo\b"]),
    ("Fatigue", [r"\bfatigue\b", r"\blethargy\b", r"\bweakness\b", r"\btiredn?ess\b"]),
    ("Rash", [r"\brash\b", r"\bskin eruption\b", r"\burticaria\b"]),
    ("Pruritus (Itching)", [r"\bitch(?:ing)?\b", r"\bpruritus\b"]),
    ("Abdominal Pain", [r"\babdominal pain\b", r"\bstomach (?:pain|ache)\b", r"\bcolic\b"]),
    ("Diarrhoea", [r"\bdiarr?hoe?a\b", r"\bloose motions?\b"]),
    ("Insomnia", [r"\binsomnia\b", r"\bsleeplessness\b", r"\bcould not sleep\b"]),
    ("Palpitations", [r"\bpalpitations?\b", r"\bracing heart\b"]),
    ("Dry Mouth", [r"\bdry mouth\b", r"\bxerostomia\b"]),
    ("Acid Reflux", [r"\bacid reflux\b", r"\bheartburn\b", r"\bhyperacidity\b"]),
]


def extract_adverse_event(doctor_notes: str) -> str | None:
    """vLLM/BioBERT stand-in: first adverse-event term found in the notes."""
    import re

    for term, patterns in AE_LEXICON:
        for pattern in patterns:
            if re.search(pattern, doctor_notes, re.IGNORECASE):
                return term
    return None


class BCPNNCausalityEngine:
    """IC = log2( P(A,B) / (P(A) * P(B)) ) — WHO/Uppsala-style disproportionality."""

    def __init__(self, p_formulation: float, p_adverse_event: float, p_joint: float):
        self.p_a = p_formulation
        self.p_b = p_adverse_event
        self.p_ab = p_joint

    def calculate_information_component(self) -> float:
        denominator = self.p_a * self.p_b
        if denominator == 0 or self.p_ab == 0:
            return float("-inf")
        return math.log2(self.p_ab / denominator)

    def evaluate(self) -> dict:
        ic = self.calculate_information_component()
        expected = self.p_a * self.p_b
        return {
            "expected": round(expected, 6),
            "observed": self.p_ab,
            "ic": round(ic, 4),
            "threshold": config.IC_THRESHOLD,
            "breach": ic > config.IC_THRESHOLD,
        }


def severity_for_ic(ic: float) -> str:
    if ic > 3:
        return "SEVERE"
    if ic > config.IC_THRESHOLD:
        return "MODERATE"
    return "MILD"


def ct04_deadline(now: datetime | None = None) -> str:
    start = now or datetime.now(timezone.utc)
    return (start + timedelta(hours=config.CT04_DEADLINE_HOURS)).isoformat()


def generate_cdsco_form_ct04_xml(
    participant_id: str, formulation_name: str, event_term: str, ic_score: float
) -> str:
    """Compiles the CDSCO Form CT-04 XML draft for SUGAM submission."""
    now = datetime.now(timezone.utc).isoformat()
    botanical = formulation_name.split(" ")[0].upper()
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<CDSCO_Form_CT04_Report>
  <Header>
    <ReportType>SERIOUS_ADVERSE_EVENT_DUE_ANALYSIS</ReportType>
    <SubmissionTimestamp>{now}</SubmissionTimestamp>
    <RegulationAuthority>Central_Licensing_Authority_DCGI</RegulationAuthority>
    <Portal>SUGAM</Portal>
  </Header>
  <StudySubject>
    <ParticipantAnonymizedUUID>{participant_id}</ParticipantAnonymizedUUID>
  </StudySubject>
  <SuspectTherapy>
    <FormulationName>{formulation_name}</FormulationName>
    <BotanicalAFIReferencedCode>AFI_I_V8_{botanical}</BotanicalAFIReferencedCode>
  </SuspectTherapy>
  <AdverseEvent>
    <ExtractedTerm>{event_term}</ExtractedTerm>
    <CausalityCriterion>Bayesian_Confidence_Propagation_Neural_Network</CausalityCriterion>
    <CausalityScoreIC>{round(ic_score, 4)}</CausalityScoreIC>
    <ReportingUrgencyLevel>CRITICAL_24_HOUR_MANDATE</ReportingUrgencyLevel>
  </AdverseEvent>
</CDSCO_Form_CT04_Report>"""
