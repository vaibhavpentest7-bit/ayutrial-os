import { useMemo, useState } from "react";
import { useStore } from "../store";
import {
  Badge,
  Button,
  Card,
  StatusBadge,
  Table,
  formatDate,
} from "../components/ui";
import { CONSENT_TIERS, type ConsentTier } from "../types";

const TIER_KIND: Record<ConsentTier, "green" | "blue" | "purple"> = {
  T1_PRIMARY: "green",
  T2_SECONDARY: "blue",
  T3_GENOMIC: "purple",
};

export default function Consent({ trialId }: { trialId: string }) {
  const store = useStore();
  const cohort = useMemo(
    () => store.participants.filter((p) => p.trialId === trialId),
    [store.participants, trialId]
  );
  const [selected, setSelected] = useState(cohort[0]?.participantId ?? "");

  const participant = store.participants.find((p) => p.participantId === selected);
  const tokens = store.consentTokens.filter((t) => t.participantId === selected);
  const activeTiers = tokens.filter((t) => t.isActive).map((t) => t.tier);
  const locked = participant?.status === "LOCKED";

  const grantable: ConsentTier[] = (
    ["T1_PRIMARY", "T2_SECONDARY", "T3_GENOMIC"] as ConsentTier[]
  ).filter((t) => !activeTiers.includes(t));

  return (
    <div className="screen">
      <div className="grid-2 consent-top">
        <Card
          title="How the Consent Vault works"
          subtitle="Section 6, DPDP Act 2023 · enforced at the storage layer"
        >
          <ol className="how-list">
            <li>
              <strong>Granular tiers.</strong> Each purpose (primary care, secondary research,
              genomic/biobank) carries its own token — T1 / T2 / T3 — so granting is additive and
              withdrawal is surgical.
            </li>
            <li>
              <strong>Cryptographic signing.</strong> Every token is a SHA-256 commitment of the
              consent state, signed by a GCP Cloud KMS key. The signature is stored in the
              PostgreSQL ledger — tampering with a row breaks the chain.
            </li>
            <li>
              <strong>Row-level security.</strong> A PostgreSQL RLS policy hides every research
              observation unless an <em>active</em> T1 token exists for that participant. Consent
              is not an app-side checkbox — the database itself refuses.
            </li>
            <li>
              <strong>Revocation = data lock.</strong> Withdrawing consent rotates the KMS key
              version, purges direct identifiers, appends a <code>D_LOCK</code> marker and
              freezes observations as anonymised records — honouring erasure while satisfying
              the NDCT 5-year retention rule.
            </li>
          </ol>
        </Card>

        <Card
          title="Consent console"
          subtitle="Select a participant, then grant or revoke purpose tiers"
        >
          <label className="field">
            <span>Participant</span>
            <select
              className="select"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {cohort.map((p) => (
                <option key={p.participantId} value={p.participantId}>
                  {p.participantId}
                  {p.status === "LOCKED" ? " — LOCKED" : ""}
                </option>
              ))}
            </select>
          </label>

          {participant && (
            <>
              <div className="kv consent-kv">
                <span>Status</span>
                <StatusBadge status={participant.status} />
                <span>Site</span>
                <span>{participant.site}</span>
                <span>Enrolled</span>
                <span>{formatDate(participant.enrolledAt)}</span>
              </div>

              <h4 className="detail-h">Active tokens</h4>
              {tokens.length === 0 && (
                <p className="crf-note-s">No tokens on file.</p>
              )}
              <ul className="token-list">
                {tokens.map((t) => (
                  <li key={t.tokenId} className={t.isActive ? "" : "token-dead"}>
                    <Badge kind={t.isActive ? TIER_KIND[t.tier] : "red"}>
                      {CONSENT_TIERS[t.tier]}
                    </Badge>
                    <span className="mono token-sig" title="KMS-signed SHA-256 commitment">
                      0x{t.tokenSignature.slice(0, 18)}…
                    </span>
                    <span className="token-kms">
                      KMS {t.kmsKeyVersion.split("@")[1]}
                    </span>
                    <span className="token-when">
                      {t.isActive
                        ? `granted ${formatDate(t.grantedAt)}`
                        : `revoked ${t.revokedAt ? formatDate(t.revokedAt) : ""}`}
                    </span>
                  </li>
                ))}
              </ul>

              {locked ? (
                <div className="inline-warn">
                  🔒 Data lock active. Re-ingestion attempts are rejected with HTTP 403 — see the
                  AyuBridge screen.
                </div>
              ) : (
                <div className="consent-actions">
                  {grantable.map((t) => (
                    <Button
                      key={t}
                      size="sm"
                      variant="outline"
                      onClick={() => store.grantConsent(selected, t)}
                    >
                      + Grant {t.split("_")[0]}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => store.revokeConsent(selected)}
                    title="Rotate KMS key, purge PII, freeze observations"
                  >
                    ⚠ Revoke all consent → data lock
                  </Button>
                </div>
              )}
              <p className="crf-note-s">
                In production these actions originate from the ABDM consent-manager artefact
                signed by the participant; the console replays them for demonstration.
              </p>
            </>
          )}
        </Card>
      </div>

      <Card
        title="Consent ledger"
        subtitle="Append-only register of KMS-signed consent state for this trial"
      >
        <Table head={["Participant", "Tier", "State", "KMS key version", "Signature", "Granted", "Revoked"]}>
          {store.consentTokens
            .filter((t) => cohort.some((p) => p.participantId === t.participantId))
            .map((t) => (
              <tr key={t.tokenId} className={t.isActive ? "" : "row-dead"}>
                <td className="mono strong">{t.participantId}</td>
                <td>
                  <Badge kind={t.isActive ? TIER_KIND[t.tier] : "red"}>{t.tier}</Badge>
                </td>
                <td>
                  {t.isActive ? <Badge kind="green">ACTIVE</Badge> : <Badge kind="red">REVOKED</Badge>}
                </td>
                <td className="token-kms">…{t.kmsKeyVersion.slice(-14)}</td>
                <td className="mono token-sig">0x{t.tokenSignature.slice(0, 12)}…</td>
                <td>{formatDate(t.grantedAt)}</td>
                <td>{t.revokedAt ? formatDate(t.revokedAt) : "—"}</td>
              </tr>
            ))}
        </Table>
      </Card>
    </div>
  );
}
