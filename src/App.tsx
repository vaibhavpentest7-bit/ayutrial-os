import { useState } from "react";
import { StoreProvider, useStore } from "./store";
import Dashboard from "./screens/Dashboard";
import Interoperability from "./screens/Interoperability";
import Participants from "./screens/Participants";
import Consent from "./screens/Consent";
import Safety from "./screens/Safety";
import Architecture from "./screens/Architecture";
import { Select } from "./components/ui";

type ScreenKey =
  | "dashboard"
  | "interop"
  | "participants"
  | "consent"
  | "safety"
  | "architecture";

const NAV: { key: ScreenKey; label: string; icon: JSX.Element; hint: string }[] = [
  {
    key: "dashboard",
    label: "Command Centre",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
    hint: "Trial portfolio overview",
  },
  {
    key: "interop",
    label: "AyuBridge Interop",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 7h9M4 12h13M4 17h7" strokeLinecap="round" />
        <path d="M16 4l4 3-4 3M20 14l-4 3 4 3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    hint: "FHIR → CDISC SDTM mapping engine",
  },
  {
    key: "participants",
    label: "Participants",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.5 19c.6-3 2.9-4.5 5.5-4.5s4.9 1.5 5.5 4.5" strokeLinecap="round" />
        <circle cx="17" cy="9" r="2.4" />
        <path d="M15.5 14.6c2.3.1 4.3 1.4 4.9 4" strokeLinecap="round" />
      </svg>
    ),
    hint: "Cohort, Ayurvedic CRF & observations",
  },
  {
    key: "consent",
    label: "Consent Vault",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" strokeLinejoin="round" />
        <path d="M9.5 12l2 2 3.5-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    hint: "DPDP Act 2023 cryptographic tokens",
  },
  {
    key: "safety",
    label: "Safety Core",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 4l1.8 4.2 4.2.4-3.2 2.9 1 4.5-3.8-2.4-3.8 2.4 1-4.5L6 8.6l4.2-.4z" strokeLinejoin="round" />
      </svg>
    ),
    hint: "BCPNN pharmacovigilance & CT-04",
  },
  {
    key: "architecture",
    label: "Architecture",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="4" width="18" height="6" rx="1.5" />
        <rect x="3" y="14" width="18" height="6" rx="1.5" />
        <path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" strokeLinecap="round" />
      </svg>
    ),
    hint: "Production system blueprint",
  },
];

function Shell() {
  const store = useStore();
  const [screen, setScreen] = useState<ScreenKey>("dashboard");
  const [trialId, setTrialId] = useState("t-ashwagandha");
  const trial = store.trials.find((t) => t.id === trialId) ?? store.trials[0];

  const screenProps = { trialId: trial.id, goTo: setScreen };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <svg viewBox="0 0 32 32">
              <rect width="32" height="32" rx="7" fill="var(--leaf-600)" />
              <path
                d="M16 6c-4 3-7 6.5-7 11a7 7 0 0 0 14 0c0-4.5-3-8-7-11z"
                fill="var(--saffron-400)"
              />
              <path
                d="M16 10v14M16 14l-3 3M16 18l3-3"
                stroke="var(--leaf-600)"
                strokeWidth="1.6"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </div>
          <div>
            <div className="brand-name">AyuTrial-OS</div>
            <div className="brand-sub">GCP-Compliant Ayurveda Research</div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((n) => (
            <button
              key={n.key}
              className={`nav-item ${screen === n.key ? "nav-item-active" : ""}`}
              onClick={() => setScreen(n.key)}
              title={n.hint}
            >
              <span className="nav-icon">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className={`proto-chip ${store.backendLive ? "proto-live" : ""}`}>
            <span className="proto-dot" />
            {store.backendLive
              ? "AYUBRIDGE BACKEND · LIVE :8000"
              : "BROWSER ENGINES · SIMULATED"}
          </div>
          <p className="proto-note">
            {store.backendLive
              ? `FastAPI + SQLite/JSON stores · KMS ${store.backendInfo?.kms_key.split("@")[1] ?? ""} · ${store.backendInfo?.sdtm_observations ?? 0} SDTM rows on server`
              : "Start ./backend/run.sh to run the real FastAPI gateway"}
            <br />
            NDCT Rules 2019 · DPDP Act 2023 · SDTM / FHIR R4 / LOINC / UCUM
          </p>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <h1 className="topbar-title">
              {NAV.find((n) => n.key === screen)?.label}
            </h1>
            <span className="topbar-hint">
              {NAV.find((n) => n.key === screen)?.hint}
            </span>
          </div>
          <div className="topbar-right">
            <Select value={trial.id} onChange={setTrialId} ariaLabel="Select trial">
              {store.trials.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.protocolCode} — {t.formulation}
                </option>
              ))}
            </Select>
            <div className="user-chip" title="Role-based access via Keycloak (prod)">
              <span className="user-avatar">PI</span>
              <span className="user-name">Dr. Principal Investigator</span>
            </div>
          </div>
        </header>

        <main className="content">
          {screen === "dashboard" && <Dashboard {...screenProps} />}
          {screen === "interop" && <Interoperability {...screenProps} />}
          {screen === "participants" && <Participants {...screenProps} />}
          {screen === "consent" && <Consent {...screenProps} />}
          {screen === "safety" && <Safety {...screenProps} />}
          {screen === "architecture" && <Architecture />}
        </main>

        <footer className="footer">
          AyuTrial-OS prototype · built for Smart India Hackathon 2026 · data shown is synthetic
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
