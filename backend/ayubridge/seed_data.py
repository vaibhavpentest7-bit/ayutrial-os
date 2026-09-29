"""Deterministic seed dataset — mulberry32 PRNG, same seed as the frontend
(src/data/seed.ts) so both sides of the demo agree on every participant."""

from . import config, db
from .crypto import kms
from .docstore import upsert_crf

TRIALS = [
    {"id": "t-ashwagandha", "protocolCode": "AYU-RCT-2026-014",
     "formulation": "Ashwagandha Ghan Vati", "phase": "III", "target": 270},
    {"id": "t-obesity", "protocolCode": "AYU-RCT-2026-021",
     "formulation": "Triphala Guggulu-Mustak Yoga", "phase": "II", "target": 170},
    {"id": "t-amalaki", "protocolCode": "AYU-RCT-2025-008",
     "formulation": "Amalaki Rasayana", "phase": "II", "target": 120},
]

SITES = [
    "AIIA New Delhi", "IPGT&RA Jamnagar", "NIA Jaipur",
    "RAGU Govt. Ayurveda College",
]

DOSHAS = ["Vata", "Pitta", "Kapha"]
AGNI = ["Manda", "Teekshna", "Vishama", "Sama"]
KOSHTHA = ["Mridu", "Madhyama", "Kroora"]

# trial assignment mirroring the frontend plan: 10 / 6 / 4 participants
PLAN = (
    [("t-ashwagandha", i) for i in range(1, 11)]
    + [("t-obesity", i) for i in range(11, 17)]
    + [("t-amalaki", i) for i in range(17, 21)]
)


def _mulberry32(seed: int):
    state = seed & 0xFFFFFFFF

    def rand() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = state
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t = (t ^ (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF))) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rand


def seed(force: bool = False) -> None:
    conn = db.connect()
    (existing,) = conn.execute("SELECT COUNT(*) FROM trial_participants").fetchone()
    if existing and not force:
        return

    rand = _mulberry32(20260925)

    def pick(arr):
        return arr[int(rand() * len(arr)) % len(arr)]

    def int_between(lo, hi):
        return lo + int(rand() * (hi - lo + 1))

    for n in range(1, 21):
        trial_id, idx = PLAN[n - 1]
        pid = f"PT-{n:04d}"
        # PT-0010 is the locked participant; a few others vary
        status = "LOCKED" if pid == "PT-0010" else (
            "ACTIVE" if n in (1, 2, 3, 4, 5, 7, 9, 12, 14, 16, 20) else
            pick(["COMPLETED", "SCREENING", "WITHDRAWN", "ACTIVE"])
        )
        conn.execute(
            """INSERT OR IGNORE INTO trial_participants
                 (participant_id, abha_id, site, trial_id, age, sex, status, enrolled_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                pid,
                f"14-{int_between(1000, 9999)}-{int_between(1000, 9999)}-{int_between(10, 99)}",
                pick(SITES),
                trial_id,
                int_between(24, 62),
                "M" if rand() > 0.45 else "F",
                status,
                f"2026-{int_between(3, 8):02d}-{int_between(1, 27):02d}T00:00:00Z",
            ),
        )

        tiers: list[str] = []
        if status != "LOCKED":
            tiers = [config.TIER_T1, config.TIER_T2] if rand() > 0.3 else [config.TIER_T1]
            if rand() > 0.7:
                tiers.append(config.TIER_T3)
        for tier in tiers:
            key_uri, signature = kms.sign_consent_state(pid, tier, True)
            conn.execute(
                """INSERT OR IGNORE INTO cryptographic_consent_tokens
                     (token_id, participant_id, consent_tier, kms_key_version,
                      token_signature, is_active, granted_at)
                   VALUES (?, ?, ?, ?, ?, 1, ?)""",
                (f"tk-{pid}-{tier}", pid, tier, key_uri, signature, db.utcnow()),
            )
        if status == "LOCKED":
            key_uri, signature = kms.sign_consent_state(pid, config.TIER_T1, False)
            conn.execute(
                """INSERT OR IGNORE INTO cryptographic_consent_tokens
                     (token_id, participant_id, consent_tier, kms_key_version,
                      token_signature, is_active, granted_at, revoked_at)
                   VALUES (?, ?, ?, ?, ?, 0, ?, ?)""",
                (f"tk-{pid}-{config.TIER_T1}", pid, config.TIER_T1, key_uri,
                 signature, db.utcnow(), db.utcnow()),
            )
            conn.execute(
                """INSERT INTO sdtm_research_observations
                     (observation_id, participant_id, domain, sdtm_variable,
                      sdtm_value, recorded_at, audit_trail_user_id, locked)
                   VALUES (?, ?, 'DM', 'D_LOCK', 'CONSENT_REVOKED', ?, 'SECURITY_CORE', 1)""",
                (db.new_id(), pid, db.utcnow()),
            )

        if status != "SCREENING":
            primary = pick(DOSHAS)
            secondary = pick(DOSHAS)
            if secondary == primary:
                secondary = "None"
            upsert_crf({
                "participant_id": pid,
                "visit_number": int_between(1, 4),
                "recorded_at": f"2026-{int_between(5, 8):02d}-{int_between(1, 27):02d}T00:00:00Z",
                "ayurvedic_variables": {
                    "prakriti": {
                        "primary_dosha": primary,
                        "secondary_dosha": secondary,
                        "semi_quantitative_score": round(rand() * 6 + 3, 1),
                    },
                    "agni": {"metabolic_state": pick(AGNI)},
                    "koshtha": {"motility_state": pick(KOSHTHA)},
                },
            })

        for _ in range(int_between(2, 4)):
            rows = [("VS", "SYSBP", str(int_between(108, 138)), "mmHg"),
                    ("VS", "DIABP", str(int_between(68, 88)), "mmHg"),
                    ("VS", "PULSE", str(int_between(62, 92)), "beats/min")]
            if trial_id == "t-obesity":
                rows.append(("VS", "WEIGHT", f"{int_between(6800, 10400) / 100:.2f}", "kg"))
            if trial_id == "t-amalaki":
                rows.append(("LB", "HBA1C", f"{int_between(510, 640) / 100:.2f}", "%"))
            if trial_id == "t-ashwagandha":
                rows.append(("LB", "HGB", f"{int_between(110, 152) / 10:.1f}", "g/dL"))
            for domain, variable, value, unit in rows:
                db.insert_observation(pid, domain, variable, f"{value} {unit}")

    conn.commit()
