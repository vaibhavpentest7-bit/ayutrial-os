import { useStore } from "../store";
import { Badge, Card, KpiCard, RelTime, StatusBadge, formatDate } from "../components/ui";
import type { Dosha } from "../types";

function EnrollmentChart({ trialId }: { trialId: string }) {
  const store = useStore();
  const trial = store.trials.find((t) => t.id === trialId)!;
  // Cumulative enrolment curve of the demo cohort subset (deterministic)
  const months = ["Apr", "May", "Jun", "Jul", "Aug", "Sep"];
  const enrolled = store.participants.filter((p) => p.trialId === trialId).length;
  const fractions = [0.18, 0.37, 0.55, 0.7, 0.86, 1];
  const W = 560;
  const H = 210;
  const pad = 30;
  const plotH = H - 2 * pad - 8;
  const vals = fractions.map((f) => Math.max(1, Math.round(f * enrolled)));
  const pts = vals.map((v, i) => ({
    x: pad + (i * (W - 2 * pad)) / (months.length - 1),
    y: H - pad - (v / enrolled) * plotH,
    v,
  }));
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const area = `${path} L${pts[pts.length - 1].x},${H - pad} L${pts[0].x},${H - pad} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart">
      <defs>
        <linearGradient id="enrol" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--leaf-500)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--leaf-500)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line
            x1={pad}
            x2={W - pad}
            y1={H - pad - g * plotH}
            y2={H - pad - g * plotH}
            className="chart-grid"
          />
          <text x={pad - 5} y={H - pad - g * plotH + 3} textAnchor="end" className="chart-label">
            {Math.round(g * enrolled)}
          </text>
        </g>
      ))}
      <text x={pad} y={15} className="chart-label">
        cumulative participants (demo cohort subset)
      </text>
      <path d={area} fill="url(#enrol)" />
      <path d={path} className="chart-line" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3.5" className="chart-dot" />
          <text x={p.x} y={p.y - 9} textAnchor="middle" className="chart-label chart-label-strong">
            {p.v}
          </text>
          <text x={p.x} y={H - 9} textAnchor="middle" className="chart-label">
            {months[i]}
          </text>
        </g>
      ))}
    </svg>
  );
}

function DoshaDonut({ trialId }: { trialId: string }) {
  const store = useStore();
  const cohort = store.participants.filter((p) => p.trialId === trialId && p.status !== "LOCKED");
  const counts: Record<Dosha, number> = { Vata: 0, Pitta: 0, Kapha: 0 };
  cohort.forEach((p) => (counts[p.ayurvedicProfile.prakriti.primary] += 1));
  const total = cohort.length || 1;
  const colors: Record<Dosha, string> = {
    Vata: "var(--vata)",
    Pitta: "var(--pitta)",
    Kapha: "var(--kapha)",
  };
  let acc = 0;
  const R = 54;
  const C = 2 * Math.PI * R;
  return (
    <div className="donut-row">
      <svg viewBox="0 0 140 140" className="donut">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--line)" strokeWidth="18" />
        {(Object.keys(counts) as Dosha[]).map((d) => {
          const frac = counts[d] / total;
          const dash = `${frac * C} ${C}`;
          const offset = -acc * C;
          acc += frac;
          return (
            <circle
              key={d}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={colors[d]}
              strokeWidth="18"
              strokeDasharray={dash}
              strokeDashoffset={offset}
              transform="rotate(-90 70 70)"
              strokeLinecap="butt"
            />
          );
        })}
        <text x="70" y="66" textAnchor="middle" className="donut-num">
          {cohort.length}
        </text>
        <text x="70" y="82" textAnchor="middle" className="donut-label">
          participants
        </text>
      </svg>
      <div className="donut-legend">
        {(Object.keys(counts) as Dosha[]).map((d) => (
          <div key={d} className="legend-item">
            <span className="legend-swatch" style={{ background: colors[d] }} />
            <span className="legend-name">{d}</span>
            <span className="legend-val">{counts[d]}</span>
          </div>
        ))}
        <p className="donut-note">Prakriti distribution (primary dosha), sourced from the MongoDB CRF store.</p>
      </div>
    </div>
  );
}

export default function Dashboard({
  trialId,
  goTo,
}: {
  trialId: string;
  goTo: (s: "interop" | "safety" | "consent" | "participants") => void;
}) {
  const store = useStore();
  const trial = store.trials.find((t) => t.id === trialId)!;
  const cohort = store.participants.filter((p) => p.trialId === trialId);
  const active = cohort.filter((p) => p.status === "ACTIVE").length;
  const consentedPct = (() => {
    const lockedOrWithdrawn = cohort.filter(
      (p) => p.status === "LOCKED" || p.status === "WITHDRAWN"
    ).length;
    return Math.round(((cohort.length - lockedOrWithdrawn) / (cohort.length || 1)) * 100);
  })();
  const trialAes = store.adverseEvents.filter((ae) => ae.trialId === trialId);
  const pendingCt04 = trialAes.filter(
    (ae) => ae.ct04 && ae.ct04.status !== "SUBMITTED"
  ).length;
  const openAes = trialAes.filter((ae) => !ae.ct04 || ae.ct04.status !== "SUBMITTED").length;
  const sdJanRows = store.observations.filter((o) => o.participantId.startsWith("PT-")).length;

  return (
    <div className="screen">
      <Card className="trial-banner" pad={false}>
        <div className="trial-banner-main">
          <div className="trial-code-row">
            <Badge kind="blue">{trial.protocolCode}</Badge>
            <StatusBadge status={trial.status} />
            <Badge kind="neutral">Phase {trial.phase}</Badge>
            <Badge kind="teal">CDSCO {trial.cdscoApproval}</Badge>
          </div>
          <h2 className="trial-title">{trial.title}</h2>
          <p className="trial-meta">
            <strong>{trial.formulation}</strong> · PI: {trial.pi} · Primary endpoint:{" "}
            {trial.primaryEndpoint}
          </p>
        </div>
        <div className="trial-banner-side">
          <div className="ring">
            <svg viewBox="0 0 84 84">
              <circle cx="42" cy="42" r="34" fill="none" stroke="var(--line)" strokeWidth="9" />
              <circle
                cx="42"
                cy="42"
                r="34"
                fill="none"
                stroke="var(--leaf-500)"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={`${(cohort.length / trial.target) * 213.6} 213.6`}
                transform="rotate(-90 42 42)"
              />
              <text x="42" y="40" textAnchor="middle" className="ring-num">
                {Math.round((cohort.length / trial.target) * 100)}%
              </text>
              <text x="42" y="54" textAnchor="middle" className="ring-label">
                of target
              </text>
            </svg>
          </div>
        </div>
      </Card>

      <div className="kpi-grid">
        <KpiCard
          label="Enrolled / Target"
          value={cohort.length}
          unit={` / ${trial.target}`}
          hint={`${active} actively dosing`}
          accent="green"
          icon="👥"
        />
        <KpiCard
          label="Consent Coverage"
          value={consentedPct}
          unit="%"
          hint="DPDP Act 2023 · KMS-signed tokens"
          accent="teal"
          icon="🛡️"
        />
        <KpiCard
          label="SDTM Records"
          value={sdJanRows.toLocaleString("en-IN")}
          hint="All trials · PostgreSQL, RLS enforced"
          accent="blue"
          icon="🗄️"
        />
        <KpiCard
          label="Open Adverse Events"
          value={openAes}
          hint={`${pendingCt04} CT-04 awaiting SUGAM submission`}
          accent={openAes > 0 ? "amber" : "green"}
          icon="⚠️"
        />
        <KpiCard
          label="Data Locks"
          value={store.participants.filter((p) => p.status === "LOCKED").length}
          hint="DPDP right-to-be-forgotten honoured"
          accent="purple"
          icon="🔒"
        />
      </div>

      <div className="grid-2-1">
        <Card
          title="Enrolment trajectory"
          subtitle={`Demo cohort subset across all sites · full study target ${trial.target} participants`}
        >
          <EnrollmentChart trialId={trialId} />
          <div className="site-strip">
            {trial.sites.map((s) => (
              <div key={s.name} className="site-cell">
                <div className="site-name">{s.name}</div>
                <div className="site-bar">
                  <div
                    className="site-bar-fill"
                    style={{ width: `${(s.enrolled / s.target) * 100}%` }}
                  />
                </div>
                <div className="site-num">
                  {s.enrolled}/{s.target}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Ayurvedic cohort profile" subtitle="Prakriti · primary dosha">
          <DoshaDonut trialId={trialId} />
        </Card>
      </div>

      <div className="grid-2-1">
        <Card
          title="Compliance & safety shortcuts"
          subtitle="Jump straight into the demo-critical flows"
        >
          <div className="shortcut-row">
            <button className="shortcut" onClick={() => goTo("interop")}>
              <span className="shortcut-icon">🔁</span>
              <span>
                <strong>Run a live FHIR → SDTM mapping</strong>
                <small>Watch an EMR bundle become CDISC-grounded data</small>
              </span>
            </button>
            <button className="shortcut" onClick={() => goTo("consent")}>
              <span className="shortcut-icon">🗝️</span>
              <span>
                <strong>Revoke consent (DPDP)</strong>
                <small>Key rotation + retrospective data lock</small>
              </span>
            </button>
            <button className="shortcut" onClick={() => goTo("safety")}>
              <span className="shortcut-icon">🧠</span>
              <span>
                <strong>Analyse a safety note</strong>
                <small>BioBERT → BCPNN → CDSCO Form CT-04</small>
              </span>
            </button>
            <button className="shortcut" onClick={() => goTo("participants")}>
              <span className="shortcut-icon">🧾</span>
              <span>
                <strong>Review a participant CRF</strong>
                <small>Prakriti · Agni · Koshtha alongside SDTM</small>
              </span>
            </button>
          </div>
        </Card>
        <Card title="Recent activity" subtitle="Immutable audit ledger">
          <ul className="activity">
            {store.activity.slice(0, 6).map((a) => (
              <li key={a.id} className={`activity-kind-${a.kind}`}>
                <div className="activity-top">
                  <span className="activity-actor">{a.actor}</span>
                  <RelTime iso={a.at} />
                </div>
                <div className="activity-text">{a.text}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Study calendar" subtitle="Upcoming regulatory & protocol milestones">
        <div className="calendar-row">
          {[
            { when: "Oct 02", what: "DSMB quarterly review", tag: "GOVERNANCE" },
            { when: "Oct 11", what: "SUGAM CT-04 queue flush (24h mandate audit)", tag: "SAFETY" },
            { when: "Oct 18", what: "Interim analysis data cut — AyuBridge freeze", tag: "DATA" },
            { when: "Nov 06", what: "CDSCO annual progress report due", tag: "REGULATORY" },
          ].map((m) => (
            <div key={m.when} className="cal-cell">
              <div className="cal-when">{m.when}</div>
              <div className="cal-what">{m.what}</div>
              <Badge kind="neutral">{m.tag}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
