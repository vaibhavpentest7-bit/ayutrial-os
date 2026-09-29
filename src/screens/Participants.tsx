import { useMemo, useState } from "react";
import { useStore } from "../store";
import {
  Badge,
  Card,
  EmptyState,
  RelTime,
  Select,
  StatusBadge,
  Table,
  formatDate,
  type BadgeKind,
} from "../components/ui";
import type { Dosha, Participant } from "../types";

const DOSHA_KIND: Record<Dosha, BadgeKind> = {
  Vata: "blue",
  Pitta: "amber",
  Kapha: "green",
};

function DoshaBars({ p }: { p: Participant }) {
  const { prakriti, agni, koshtha } = p.ayurvedicProfile;
  const score = prakriti.score;
  const pct = Math.min(100, (score / 10) * 100);
  return (
    <div className="crf-grid">
      <div className="crf-item">
        <span className="crf-k">Prakriti</span>
        <span className="crf-v">
          {prakriti.primary}
          {prakriti.secondary !== "None" ? ` / ${prakriti.secondary}` : ""}
        </span>
        <div className="mini-bar">
          <div className="mini-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="crf-note-s">{score.toFixed(1)} / 10 semi-quantitative</span>
      </div>
      <div className="crf-item">
        <span className="crf-k">Agni (metabolic state)</span>
        <span className="crf-v">{agni}</span>
        <span className="crf-note-s">
          {agni === "Sama"
            ? "balanced digestive fire"
            : agni === "Manda"
            ? "diminished — slow metabolism"
            : agni === "Teekshna"
            ? "excessive — sharp metabolism"
            : "irregular — variable metabolism"}
        </span>
      </div>
      <div className="crf-item">
        <span className="crf-k">Koshtha (bowel motility)</span>
        <span className="crf-v">{koshtha}</span>
        <span className="crf-note-s">
          {koshtha === "Mridu" ? "soft / sensitive" : koshtha === "Madhyama" ? "moderate" : "hard / sluggish"}
        </span>
      </div>
    </div>
  );
}

function Detail({ participantId }: { participantId: string }) {
  const store = useStore();
  const p = store.participants.find((x) => x.participantId === participantId)!;
  const trial = store.trials.find((t) => t.id === p.trialId)!;
  const obs = store.observations
    .filter((o) => o.participantId === p.participantId)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    .slice(0, 14);
  const tokens = store.consentTokens.filter((t) => t.participantId === p.participantId);
  const crfs = store.crfDocuments.filter((c) => c.participantId === p.participantId);

  return (
    <Card
      className="detail-card"
      title={
        <span>
          {p.participantId}{" "}
          <span className="detail-trial">· {trial.protocolCode}</span>
        </span>
      }
      subtitle={`${p.site} · enrolled ${formatDate(p.enrolledAt)} · record follows the selected cohort row`}
      right={<Badge kind="teal">PARTICIPANT RECORD</Badge>}
    >
      {p.status === "LOCKED" && (
        <div className="inline-warn" style={{ marginBottom: 14 }}>
          🔒 DPDP revocation enforced — identity purged, KMS key version rotated. Observations
          remain frozen for the NDCT-mandated retention period as fully anonymised research
          records.
        </div>
      )}
      <div className="detail-cols">
        <div>
          <h4 className="detail-h">Baseline (demographics masked)</h4>
          <div className="kv">
            <span>ABHA ID</span>
            <span className="mono">
              {p.piiPurged ? "••• PURGED (DPDP §6)" : `14-XXXX-XXXX-${p.abhaId.slice(-2)}`}
            </span>
            <span>Age band</span>
            <span>{p.status === "LOCKED" ? "—" : `${Math.floor(p.age / 10) * 10}s`}</span>
            <span>Sex</span>
            <span>{p.status === "LOCKED" ? "—" : p.sex}</span>
            <span>Status</span>
            <span>
              <StatusBadge status={p.status} />
            </span>
          </div>
          <h4 className="detail-h">Consent tokens (KMS-signed)</h4>
          {tokens.length === 0 && <p className="crf-note-s">No tokens — consent withdrawn.</p>}
          <ul className="token-list">
            {tokens.map((t) => (
              <li key={t.tokenId}>
                <Badge kind={t.isActive ? "green" : "red"}>{t.tier}</Badge>
                <span className="mono token-sig">0x{t.tokenSignature.slice(0, 14)}…</span>
                <span className="token-kms" title={t.kmsKeyVersion}>
                  KMS @{t.kmsKeyVersion.split("@")[1]}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="detail-h">Ayurvedic CRF (MongoDB)</h4>
          <DoshaBars p={p} />
          <p className="crf-note-s">
            {crfs.length} CRF document{crfs.length === 1 ? "" : "s"} on file · latest visit #
            {Math.max(...crfs.map((c) => c.visitNumber), 0)}
          </p>
        </div>
      </div>

      <h4 className="detail-h">SDTM observations (PostgreSQL)</h4>
      <Table head={["Domain", "Variable", "Value", "Recorded", "Audit user", "State"]}>
        {obs.map((o) => (
          <tr key={o.observationId}>
            <td>
              <Badge kind="blue">{o.domain}</Badge>
            </td>
            <td className="mono">{o.variable}</td>
            <td className="mono">
              {o.value} {o.unit ?? ""}
            </td>
            <td>
              <RelTime iso={o.recordedAt} />
            </td>
            <td className="mono">{o.auditUserId}</td>
            <td>
              {o.locked ? <Badge kind="red">FROZEN</Badge> : <Badge kind="green">RW</Badge>}
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

export default function Participants({ trialId }: { trialId: string }) {
  const store = useStore();
  const [filter, setFilter] = useState("ALL");
  const [selected, setSelected] = useState<string | null>(null);
  const cohort = useMemo(
    () =>
      store.participants
        .filter((p) => p.trialId === trialId)
        .filter((p) => filter === "ALL" || p.status === filter),
    [store.participants, trialId, filter]
  );
  // Keep a record open so the review panel is always demonstrable
  const activeSelection =
    selected && cohort.some((p) => p.participantId === selected)
      ? selected
      : (cohort.find((p) => p.status !== "LOCKED") ?? cohort[0])?.participantId ?? null;

  return (
    <div className="screen">
      <Card
        title="Study cohort"
        subtitle="Click any row to open the participant record · PII decoupled from research observations"
        right={
          <Select value={filter} onChange={setFilter} ariaLabel="Filter status">
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SCREENING">Screening</option>
            <option value="COMPLETED">Completed</option>
            <option value="WITHDRAWN">Withdrawn</option>
            <option value="LOCKED">Data-locked</option>
          </Select>
        }
      >
        <Table
          head={["Participant", "Status", "Site", "Prakriti", "Agni", "Koshtha", "Consent", "SDTM rows", ""]}
          empty={cohort.length === 0}
        >
          {cohort.map((p) => {
            const rows = store.observations.filter(
              (o) => o.participantId === p.participantId
            ).length;
            const tiers = store.consentTokens
              .filter((t) => t.participantId === p.participantId && t.isActive)
              .map((t) => t.tier.split("_")[0]);
            const isSelected = activeSelection === p.participantId;
            return (
              <tr
                key={p.participantId}
                className={`row-click ${isSelected ? "row-selected" : ""}`}
                onClick={() => setSelected(p.participantId)}
              >
                <td className="mono strong">{p.participantId}</td>
                <td>
                  <StatusBadge status={p.status} />
                </td>
                <td>{p.site}</td>
                <td>
                  <Badge kind={DOSHA_KIND[p.ayurvedicProfile.prakriti.primary]}>
                    {p.ayurvedicProfile.prakriti.primary}
                  </Badge>
                </td>
                <td>{p.ayurvedicProfile.agni}</td>
                <td>{p.ayurvedicProfile.koshtha}</td>
                <td className="mono">{tiers.length ? tiers.join(" · ") : "—"}</td>
                <td className="mono">{rows}</td>
                <td className="row-open-hint">{isSelected ? "◉ open" : "view →"}</td>
              </tr>
            );
          })}
        </Table>
        {cohort.length === 0 && (
          <EmptyState title="No participants" body="Adjust the status filter to see the cohort." />
        )}
      </Card>

      {activeSelection && (
        <Detail participantId={activeSelection} />
      )}
    </div>
  );
}
