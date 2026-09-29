import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type WebhookResult } from "../store";
import { EMR_SCENARIOS } from "../lib/fhir";
import { Badge, Button, Card, CodeBlock, Select, Table } from "../components/ui";

const STAGE_ICONS: Record<string, string> = {
  webhook: "📨",
  validate: "✅",
  consent: "🔐",
  translate: "🔁",
  persist: "🗄️",
};

function StatusPill({ status }: { status: "ok" | "fail" | "skipped" }) {
  if (status === "ok") return <Badge kind="green">PASS</Badge>;
  if (status === "fail") return <Badge kind="red">FAIL</Badge>;
  return <Badge kind="slate">SKIP</Badge>;
}

export default function Interoperability({ trialId }: { trialId: string }) {
  const store = useStore();
  const [scenarioKey, setScenarioKey] = useState(EMR_SCENARIOS[2].key);
  const cohort = useMemo(
    () => store.participants.filter((p) => p.trialId === trialId),
    [store.participants, trialId]
  );
  const [participantId, setParticipantId] = useState(cohort[0]?.participantId ?? "");
  useEffect(() => {
    if (!cohort.some((p) => p.participantId === participantId)) {
      setParticipantId(cohort[0]?.participantId ?? "");
    }
  }, [cohort, participantId]);

  const [result, setResult] = useState<WebhookResult | null>(null);
  const [revealed, setRevealed] = useState(0);
  const timers = useRef<number[]>([]);
  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const scenario = EMR_SCENARIOS.find((s) => s.key === scenarioKey)!;
  const participant = store.participants.find((p) => p.participantId === participantId);
  const locked = participant?.status === "LOCKED";

  const run = async () => {
    clearTimers();
    const res = await store.ingest({ scenarioKey, participantId });
    setResult(res);
    setRevealed(0);
    res.stages.forEach((_, i) => {
      timers.current.push(
        window.setTimeout(() => setRevealed(i + 1), 450 * (i + 1))
      );
    });
  };

  return (
    <div className="screen">
      <Card className="intro-card">
        <div className="intro-grid">
          <div>
            <h2>AyuBridge — the interoperability engine</h2>
            <p>
              Hospital EMRs speak <strong>HL7 FHIR R4</strong>; regulators and the global
              research community expect <strong>CDISC SDTM</strong>. AyuBridge listens for EMR
              webhooks, validates against NRCeS profiles, enforces the DPDP 2023 consent gate,
              normalises units (UCUM) and LOINC codes into SDTM variables, and routes
              qualitative Ayurvedic diagnostics to the MongoDB CRF store — in one pass.
            </p>
          </div>
          <div className="pipeline-viz">
            <div className="pipe-node">🏥 EMR / HIS</div>
            <div className="pipe-arrow">⟶</div>
            <div className="pipe-node pipe-node-hero">⚡ AyuBridge</div>
            <div className="pipe-arrow">⟶</div>
            <div className="pipe-node">📊 CDISC SDTM + 🌿 CRF</div>
          </div>
        </div>
      </Card>

      <div className="grid-2">
        <Card
          title="Simulated EMR webhook"
          subtitle="Pick a scenario and fire it at the gateway"
          right={
            result ? (
              <Badge kind={result.httpStatus === 201 ? "green" : "red"}>
                HTTP {result.httpStatus}
              </Badge>
            ) : undefined
          }
        >
          <div className="form-row">
            <label className="field">
              <span>EMR scenario</span>
              <Select value={scenarioKey} onChange={setScenarioKey} ariaLabel="EMR scenario">
                {EMR_SCENARIOS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="field">
              <span>Participant (Patient.id)</span>
              <Select
                value={participantId}
                onChange={setParticipantId}
                ariaLabel="Participant"
              >
                {cohort.map((p) => (
                  <option key={p.participantId} value={p.participantId}>
                    {p.participantId}
                    {p.status === "LOCKED" ? " — LOCKED" : ""}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <p className="scenario-desc">{scenario.description}</p>
          {locked && (
            <div className="inline-warn">
              ⚠️ This participant is under a DPDP data lock — the consent gate will reject the
              bundle with HTTP 403. That is the compliance engine working as designed.
            </div>
          )}
          <div className="form-actions">
            <Button onClick={run}>Send webhook →</Button>
          </div>
          <CodeBlock lang="http" code={`POST /api/v1/emr/webhook\nX-AyuBridge-Signature: sha256=…

${JSON.stringify(scenario.build(participantId), null, 2)}`} />
        </Card>

        <Card title="Pipeline trace" subtitle="Every hop is audited">
          {result ? (
            <ol className="stages">
              {result.stages.map((s, i) => (
                <li
                  key={s.key}
                  className={`stage stage-${s.status} ${
                    i < revealed ? "stage-in" : "stage-pending"
                  }`}
                >
                  <div className="stage-head">
                    <span className="stage-icon">{STAGE_ICONS[s.key] ?? "•"}</span>
                    <div className="stage-titles">
                      <div className="stage-title">{s.title}</div>
                      <div className="stage-sub">{s.subtitle}</div>
                    </div>
                    <StatusPill status={s.status} />
                  </div>
                  <p className="stage-detail">{s.detail}</p>
                </li>
              ))}
              {revealed >= result.stages.length && (
                <li className={`stage-response ${result.httpStatus === 201 ? "ok" : "fail"}`}>
                  <code>
                    {result.httpStatus}{" "}
                    {result.httpStatus === 201
                      ? "Created"
                      : result.httpStatus === 403
                      ? "Forbidden"
                      : "Unprocessable Entity"}
                  </code>
                  <span>{JSON.stringify(result.response)}</span>
                </li>
              )}
            </ol>
          ) : (
            <div className="pipeline-placeholder">
              <div className="pipeline-placeholder-ring" />
              Fire a webhook to trace the pipeline.
            </div>
          )}
        </Card>
      </div>

      {result?.mapping && revealed >= result.stages.length && (
        <div className="grid-2">
          <Card
            title="CDISC SDTM mapping output"
            subtitle="LOINC-coded observations grounded to SDTMIG variables"
          >
            <Table
              head={["Domain", "SDTM variable", "Value", "Unit", "Lineage (LOINC → UCUM)"]}
            >
              {result.mapping.sdtmRows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <Badge kind="blue">{r.domain}</Badge>
                  </td>
                  <td className="mono">{r.variable}</td>
                  <td className="mono">{r.value}</td>
                  <td>{r.unit ?? "—"}</td>
                  <td className="lineage">
                    {r.loinc ? (
                      <>
                        <code className="loinc-chip">{r.loinc}</code>
                        {r.transformed ? (
                          <span className="ucum-note">{r.transformed}</span>
                        ) : (
                          <span className="ucum-note ucum-ok">units already UCUM-standard</span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </Table>
            <div className="persist-note">
              <span className="db-chip db-chip-pg">PostgreSQL</span> rows written under
              row-level security (only while the T1 consent token stays active) ·{" "}
              <span className="db-chip db-chip-mg">MongoDB</span> CRF document{" "}
              {result.mapping.crf ? "appended" : "not present in this bundle"}.
            </div>
          </Card>

          <Card
            title="Ayurvedic CRF document"
            subtitle="Qualitative diagnostics — schema-validated MongoDB document"
          >
            {result.mapping.crf ? (
              <>
                <div className="crf-grid">
                  <div className="crf-item">
                    <span className="crf-k">Prakriti (primary)</span>
                    <span className="crf-v">
                      {result.mapping.crf.variables.prakriti.primary_dosha}
                    </span>
                  </div>
                  <div className="crf-item">
                    <span className="crf-k">Prakriti (secondary)</span>
                    <span className="crf-v">
                      {result.mapping.crf.variables.prakriti.secondary_dosha}
                    </span>
                  </div>
                  <div className="crf-item">
                    <span className="crf-k">Semi-quant. score</span>
                    <span className="crf-v">
                      {result.mapping.crf.variables.prakriti.semi_quantitative_score}
                    </span>
                  </div>
                  <div className="crf-item">
                    <span className="crf-k">Agni (metabolic)</span>
                    <span className="crf-v">{result.mapping.crf.variables.agni.metabolic_state}</span>
                  </div>
                  <div className="crf-item">
                    <span className="crf-k">Koshtha (motility)</span>
                    <span className="crf-v">
                      {result.mapping.crf.variables.koshtha.motility_state}
                    </span>
                  </div>
                  <div className="crf-item">
                    <span className="crf-k">Visit</span>
                    <span className="crf-v">#{result.mapping.crf.visitNumber}</span>
                  </div>
                </div>
                <p className="crf-note">
                  These uncodified, tradition-specific variables cannot live in relational SDTM
                  columns — they are stored as flexible documents and joined to the same
                  participant UUID at analysis time.
                </p>
              </>
            ) : (
              <div className="inline-info">
                This bundle carried no Ayush clinical-diagnostics extension — only SDTM
                variables were produced. Try the <em>“Vitals + Ayush CRF extension”</em>{" "}
                scenario.
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
