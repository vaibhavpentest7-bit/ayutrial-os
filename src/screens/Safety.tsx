import { useMemo, useState } from "react";
import { useStore } from "../store";
import {
  Badge,
  Button,
  Card,
  CodeBlock,
  RelTime,
  Select,
  StatusBadge,
  Table,
  formatDate,
} from "../components/ui";
import { bcpnn } from "../lib/bcpnn";
import type { AdverseEvent } from "../types";

const SAMPLE_NOTES = [
  {
    label: "Sample — moderate signal",
    note:
      "Participant complained of dizziness and palpitations roughly two hours after the morning dose on visit 3. Pulse 104/min, BP 118/76. Drug withheld for 48 hours, cardiology opinion sought; ECG shows sinus tachycardia without structural abnormality.",
  },
  {
    label: "Sample — skin reaction",
    note:
      "Itching with a fine rash over both forearms appeared on day 6 of therapy. No angio-oedema. Antihistamine given, dose continued under supervision.",
  },
  {
    label: "Sample — gastrointestinal",
    note:
      "Nausea and abdominal pain after dose escalation, with hyperacidity on palpation. Managed with Avalguja-Bilvadi, symptoms settled within three days.",
  },
  {
    label: "Sample — no signal",
    note:
      "Routine review. Sleep improved, bowel regular, no complaints since last visit. Vitals stable, participant motivated to continue the regimen.",
  },
];

function Countdown({ deadline }: { deadline: string }) {
  const ms = new Date(deadline).getTime() - Date.now();
  const hours = Math.max(0, ms / 3600_000);
  const urgent = hours < 8;
  return (
    <span className={`countdown ${urgent ? "countdown-urgent" : ""}`}>
      ⏱ {hours >= 1 ? `${hours.toFixed(0)}h` : "expired"} to NDCT 24-hour mandate
    </span>
  );
}

function AeRow({ ae }: { ae: AdverseEvent }) {
  const store = useStore();
  return (
    <tr>
      <td className="mono strong">{ae.aeId}</td>
      <td className="mono">{ae.participantId}</td>
      <td>{ae.extractedTerm ?? <span className="crf-note-s">—</span>}</td>
      <td>
        <Badge
          kind={ae.severity === "SEVERE" ? "red" : ae.severity === "MODERATE" ? "amber" : "teal"}
        >
          {ae.severity}
        </Badge>
      </td>
      <td className="mono">
        {ae.icScore != null ? ae.icScore.toFixed(2) : "—"}
      </td>
      <td>
        <RelTime iso={ae.detectedAt} />
      </td>
      <td>
        {ae.ct04 ? (
          <div className="ct-cell">
            <StatusBadge status={ae.ct04.status} />
            {ae.ct04.status !== "SUBMITTED" && <Countdown deadline={ae.ct04.deadline} />}
          </div>
        ) : (
          <span className="crf-note-s">below threshold</span>
        )}
      </td>
      <td>
        {ae.ct04?.status === "DRAFT" || ae.ct04?.status === "QUEUED" ? (
          <Button size="sm" variant="outline" onClick={() => store.submitCt04(ae.aeId)}>
            Submit to SUGAM
          </Button>
        ) : ae.ct04 ? (
          <span className="crf-note-s">{ae.ct04.submittedAt ? formatDate(ae.ct04.submittedAt) : ""}</span>
        ) : (
          ""
        )}
      </td>
    </tr>
  );
}

export default function Safety({ trialId }: { trialId: string }) {
  const store = useStore();
  const trial = store.trials.find((t) => t.id === trialId)!;
  const cohort = useMemo(
    () => store.participants.filter((p) => p.trialId === trialId),
    [store.participants, trialId]
  );
  const [participantId, setParticipantId] = useState(cohort[0]?.participantId ?? "");
  const [note, setNote] = useState(SAMPLE_NOTES[0].note);
  const [running, setRunning] = useState(false);
  const [analysis, setAnalysis] = useState<{ ae: AdverseEvent; xml: string } | null>(null);

  // Live BCPNN playground
  const [pA, setPA] = useState(0.1);
  const [pB, setPB] = useState(0.02);
  const [pAB, setPAB] = useState(0.04);
  const live = bcpnn({ pFormulation: pA, pAdverseEvent: pB, pJoint: pAB });

  const trialAes = store.adverseEvents.filter((ae) => ae.trialId === trialId);
  void trialAes;

  const run = async () => {
    setRunning(true);
    setAnalysis(null);
    // Simulated vLLM/BioBERT latency for demo realism
    window.setTimeout(async () => {
      const res = await store.analyzeSafety(participantId, note, trial.formulation);
      setAnalysis(res);
      setRunning(false);
    }, 900);
  };

  const gaugeAngle = Math.max(-90, Math.min(90, (live.ic / 5) * 90));

  return (
    <div className="screen">
      <div className="grid-2">
        <Card
          title="Safety analysis studio"
          subtitle="Clinician note → adverse-event extraction → Bayesian causality → CT-04"
        >
          <label className="field">
            <span>Participant</span>
            <Select
              value={participantId}
              onChange={setParticipantId}
              ariaLabel="Participant"
            >
              {cohort.map((p) => (
                <option key={p.participantId} value={p.participantId}>
                  {p.participantId}
                </option>
              ))}
            </Select>
          </label>

          <label className="field">
            <span>Clinician note (free text)</span>
            <textarea
              className="textarea"
              rows={5}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <div className="sample-row">
            {SAMPLE_NOTES.map((s) => (
              <button
                key={s.label}
                className={`chip ${note === s.note ? "chip-on" : ""}`}
                onClick={() => {
                  setNote(s.note);
                  setAnalysis(null);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="form-actions">
            <Button onClick={run} disabled={running || !participantId}>
              {running ? "BioBERT inference…" : "Run safety pipeline →"}
            </Button>
          </div>

          {running && (
            <div className="thinking">
              <span className="thinking-dot" /> local vLLM endpoint · dmis-lab/biobert-v1.1 —
              extracting adverse-event terms…
            </div>
          )}

          {analysis && (
            <div className="analysis-out">
              <div className="kv">
                <span>Extracted AE term</span>
                <span>
                  {analysis.ae.extractedTerm ? (
                    <Badge kind="amber">{analysis.ae.extractedTerm}</Badge>
                  ) : (
                    <Badge kind="green">No adverse-event signal</Badge>
                  )}
                </span>
                <span>BCPNN IC score</span>
                <span className="mono">{analysis.ae.icScore?.toFixed(3)}</span>
                <span>Severity (auto-triaged)</span>
                <span>
                  <StatusBadge status={analysis.ae.severity} />
                </span>
              </div>
              {analysis.ae.ct04 && (
                <>
                  <div className="inline-warn">
                    🚨 IC &gt; 1.5 — signal breaches the pharmacovigilance threshold. A draft{" "}
                    <strong>CDSCO Form CT-04</strong> has been compiled and the{" "}
                    <strong>24-hour</strong> mandatory reporting clock has started. Queued for
                    SUGAM submission.
                  </div>
                  <CodeBlock lang="xml" code={analysis.xml} />
                </>
              )}
              {!analysis.ae.extractedTerm && (
                <p className="crf-note-s">
                  The note is archived to the safety ledger; no causality computation was
                  triggered.
                </p>
              )}
              {analysis.ae.extractedTerm && !analysis.ae.ct04 && (
                <p className="crf-note-s">
                  Signal present but IC ≤ 1.5 — logged for cumulative surveillance; no CT-04
                  needed yet.
                </p>
              )}
            </div>
          )}
        </Card>

        <Card
          title="BCPNN information component — live"
          subtitle="IC = log₂( P(A,B) / (P(A)·P(B)) ) — the Uppsala-style disproportionality score"
        >
          <div className="bcpnn-panel">
            <svg viewBox="0 0 220 130" className="gauge">
              <defs>
                <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="var(--leaf-500)" />
                  <stop offset="55%" stopColor="var(--saffron-400)" />
                  <stop offset="100%" stopColor="var(--red-500)" />
                </linearGradient>
              </defs>
              <path
                d="M30 110 A 80 80 0 0 1 190 110"
                fill="none"
                stroke="var(--line)"
                strokeWidth="16"
                strokeLinecap="round"
              />
              <path
                d="M30 110 A 80 80 0 0 1 190 110"
                fill="none"
                stroke="url(#gaugeGrad)"
                strokeWidth="16"
                strokeLinecap="round"
                strokeDasharray={`${((live.ic + 2) / 7) * 251} 251`}
              />
              <g transform={`rotate(${gaugeAngle} 110 110)`}>
                <line x1="110" y1="110" x2="110" y2="48" className="gauge-needle" />
              </g>
              <circle cx="110" cy="110" r="6" className="gauge-hub" />
              <text x="110" y="92" textAnchor="middle" className="gauge-num">
                {Number.isFinite(live.ic) ? live.ic.toFixed(2) : "−∞"}
              </text>
            </svg>
            <div className="slider-col">
              <label className="slider">
                <span>P(A) formulation exposure</span>
                <input
                  type="range"
                  min={0.01}
                  max={0.5}
                  step={0.01}
                  value={pA}
                  onChange={(e) => setPA(Number(e.target.value))}
                />
                <em className="mono">{(pA * 100).toFixed(0)}%</em>
              </label>
              <label className="slider">
                <span>P(B) background AE incidence</span>
                <input
                  type="range"
                  min={0.005}
                  max={0.2}
                  step={0.005}
                  value={pB}
                  onChange={(e) => setPB(Number(e.target.value))}
                />
                <em className="mono">{(pB * 100).toFixed(1)}%</em>
              </label>
              <label className="slider">
                <span>P(A,B) observed co-occurrence</span>
                <input
                  type="range"
                  min={0.001}
                  max={0.2}
                  step={0.001}
                  value={pAB}
                  onChange={(e) => setPAB(Number(e.target.value))}
                />
                <em className="mono">{(pAB * 100).toFixed(1)}%</em>
              </label>
            </div>
          </div>
          <div className="bcpnn-read">
            <div className="kv">
              <span>Expected co-occurrence P(A)·P(B)</span>
              <span className="mono">{(live.expected * 100).toFixed(2)}%</span>
              <span>Observed</span>
              <span className="mono">{(live.observed * 100).toFixed(2)}%</span>
              <span>Signal</span>
              <span>
                {live.flag ? (
                  <Badge kind="red">BREACH · IC &gt; 1.5 → CT-04</Badge>
                ) : (
                  <Badge kind="green">below reporting threshold</Badge>
                )}
              </span>
            </div>
            <p className="crf-note-s">
              Multi-herbal formulations raise a hard question: which ingredient caused the
              event? BCPNN scores the <em>combination</em> statistically, giving regulators a
              reproducible causality number instead of a subjective guess. Drag P(A,B) upward to
              see a breach.
            </p>
          </div>
        </Card>
      </div>

      <Card
        title="Adverse-event inbox"
        subtitle={`Safety ledger for ${trial.protocolCode} — CT-04 queue reflects the NDCT 24-hour mandate`}
      >
        <Table
          head={["AE ID", "Participant", "Extracted term", "Severity", "IC", "Detected", "CT-04", "Action"]}
        >
          {trialAes.map((ae) => (
            <AeRow key={ae.aeId} ae={ae} />
          ))}
          {analysis && !trialAes.some((a) => a.aeId === analysis.ae.aeId) && (
            <AeRow ae={analysis.ae} />
          )}
        </Table>
      </Card>
    </div>
  );
}
