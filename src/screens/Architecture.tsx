import { Badge, Card } from "../components/ui";

const LAYERS: {
  title: string;
  tag: string;
  nodes: { name: string; note: string; kind: "app" | "data" | "ai" | "infra" }[];
}[] = [
  {
    title: "Experience layer",
    tag: "this prototype + production web/mobile",
    nodes: [
      { name: "PI / CRA Console", note: "React + TypeScript dashboard (what you are browsing)", kind: "app" },
      { name: "Participant consent app", note: "ABDM-linked consent artefact signing", kind: "app" },
      { name: "Ethics committee portal", note: "SAE review & audit exports", kind: "app" },
    ],
  },
  {
    title: "AyuBridge interoperability core",
    tag: "FastAPI · Python 3.12",
    nodes: [
      { name: "EMR webhook receiver", note: "POST /api/v1/emr/webhook · HMAC signatures", kind: "infra" },
      { name: "HAPI FHIR $validate", note: "NRCeS India IG conformance", kind: "infra" },
      { name: "FHIR → SDTM translator", note: "LOINC dictionary · UCUM normalisation", kind: "app" },
      { name: "Consent gate", note: "PostgreSQL token lookup · DPDP 2023", kind: "app" },
    ],
  },
  {
    title: "Data & trust layer",
    tag: "sovereign cloud · asia-south1",
    nodes: [
      { name: "PostgreSQL 16", note: "SDTM observations · RLS consent policy · pgvector", kind: "data" },
      { name: "MongoDB 7.0", note: "Ayurvedic CRF documents (Prakriti/Agni/Koshtha)", kind: "data" },
      { name: "GCP Cloud KMS", note: "Consent token signing · revocation key rotation", kind: "infra" },
      { name: "Keycloak", note: "Role-based access · full 21 CFR-11-style audit trail", kind: "infra" },
    ],
  },
  {
    title: "AI safety core",
    tag: "local inference · no data egress",
    nodes: [
      { name: "BioBERT NER", note: "vLLM endpoint · adverse-event extraction from notes", kind: "ai" },
      { name: "BCPNN engine", note: "IC disproportionality · Uppsala-style causality", kind: "ai" },
      { name: "Celery + RabbitMQ", note: "Async CT-04 compilation · 24h mandate timers", kind: "infra" },
      { name: "SUGAM connector", note: "CDSCO Form CT-04 submission queue", kind: "app" },
    ],
  },
];

const COMPLIANCE: { rule: string; where: string }[] = [
  { rule: "NDCT Rules 2019 — SAE reporting within 24h to licensing authority", where: "Safety Core → CT-04 queue with countdown timers" },
  { rule: "NDCT Rules 2019 — 5-year retention of trial records", where: "Data lock keeps anonymised observations past consent withdrawal" },
  { rule: "DPDP Act 2023 — purpose-limited, revocable consent", where: "T1/T2/T3 KMS-signed tokens + RLS enforcement" },
  { rule: "DPDP Act 2023 — right to erasure (§6)", where: "KMS key rotation + PII purge pipeline" },
  { rule: "GCP (ICMR/AYUSH) — participant safety & data integrity", where: "Immutable audit ledger on every observation" },
  { rule: "Interoperability — FHIR R4 (NRCeS) in, CDISC SDTM out", where: "AyuBridge translator with LOINC/UCUM grounding" },
];

export default function Architecture() {
  return (
    <div className="screen">
      <Card
        title="Production blueprint"
        subtitle="The prototype runs the same domain logic you see here; this is the deployment topology it is designed against"
      >
        <div className="arch">
          {LAYERS.map((layer) => (
            <div key={layer.title} className="arch-layer">
              <div className="arch-layer-head">
                <span className="arch-layer-title">{layer.title}</span>
                <span className="arch-layer-tag">{layer.tag}</span>
              </div>
              <div className="arch-nodes">
                {layer.nodes.map((n) => (
                  <div key={n.name} className={`arch-node arch-${n.kind}`}>
                    <div className="arch-node-name">{n.name}</div>
                    <div className="arch-node-note">{n.note}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="arch-flow">
            <span>🏥 EMR / HIS (FHIR)</span>
            <span>⟶</span>
            <span>⚡ AyuBridge</span>
            <span>⟶</span>
            <span>🗄️ PostgreSQL + 🍃 MongoDB</span>
            <span>⟶</span>
            <span>📊 SDTM datasets · 🌿 CRF · 🚨 CT-04</span>
          </div>
        </div>
      </Card>

      <div className="grid-2">
        <Card
          title="Regulatory mapping"
          subtitle="Every rule traces to a concrete mechanism — the demo narrative"
        >
          <ul className="reg-list">
            {COMPLIANCE.map((c) => (
              <li key={c.rule}>
                <Badge kind="teal">✔</Badge>
                <div>
                  <strong>{c.rule}</strong>
                  <div className="crf-note-s">{c.where}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card
          title="Why this wins"
          subtitle="The three gaps in today's Ayurveda trial infrastructure"
        >
          <div className="win-list">
            <div className="win">
              <div className="win-num">1</div>
              <div>
                <strong>Data silos → interoperability</strong>
                <p>
                  Ayurveda hospitals run EMRs that cannot speak the language of global research.
                  AyuBridge converts routine care data (FHIR) into submission-grade datasets
                  (SDTM) automatically — no manual transcription, no re-entry errors.
                </p>
              </div>
            </div>
            <div className="win">
              <div className="win-num">2</div>
              <div>
                <strong>Consent theatre → cryptographic proof</strong>
                <p>
                  Paper consent cannot be queried by a database. KMS-signed tokens make consent
                  machine-enforceable at row level and revocation instant — the exact gap the
                  DPDP Act 2023 now audits for.
                </p>
              </div>
            </div>
            <div className="win">
              <div className="win-num">3</div>
              <div>
                <strong>Slow pharmacovigilance → 24-hour AI pipeline</strong>
                <p>
                  SAE detection on multi-herbal formulations is manual and subjective. BioBERT
                  extraction plus BCPNN scoring detects, quantifies and drafts the CT-04 within
                  the mandated window — turning compliance from a risk into a feature.
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
