// ─── Simulated EMR: builds realistic HL7 FHIR R4 bundles ────────────────────
// In production these arrive via webhook from hospital EMRs (e.g. a Hospital
// Information System at the AIIA campus). Here we synthesise a few variants so
// the mapping demo can be replayed live.

import type { Dosha, AgniState, KoshthaState } from "../types";

export interface EmrScenario {
  key: string;
  label: string;
  description: string;
  build: (patientId: string) => object;
}

const AYUSH_EXT_URL =
  "https://nrces.in/standards/ayush/StructureDefinition/ayush-clinical-diagnostics";

function obs(
  loinc: string,
  display: string,
  value: { valueQuantity?: object; valueCodeableConcept?: object },
  extra: object = {}
) {
  return {
    resource: {
      resourceType: "Observation",
      status: "final",
      code: {
        coding: [{ system: "http://loinc.org", code: loinc, display }],
        text: display,
      },
      ...value,
      ...extra,
    },
  };
}

function patientResource(id: string) {
  return {
    resource: {
      resourceType: "Patient",
      id,
      identifier: [
        {
          system: "https://healthid.abdm.gov.in",
          value: `ABHA-${id.slice(0, 8).toUpperCase()}`,
        },
      ],
    },
  };
}


export const EMR_SCENARIOS: EmrScenario[] = [
  {
    key: "vitals-kg",
    label: "Vitals — SI units",
    description:
      "Routine follow-up vitals already in metric units. Maps 4 SDTM VS variables.",
    build: (pid) => ({
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        patientResource(pid),
        obs("8480-6", "Systolic Blood Pressure", {
          valueQuantity: { value: 128, unit: "mmHg", system: "http://unitsofmeasure.org" },
        }),
        obs("8462-4", "Diastolic Blood Pressure", {
          valueQuantity: { value: 82, unit: "mmHg", system: "http://unitsofmeasure.org" },
        }),
        obs("8867-4", "Heart Rate", {
          valueQuantity: { value: 74, unit: "beats/min", system: "http://unitsofmeasure.org" },
        }),
        obs("59408-5", "Oxygen Saturation", {
          valueQuantity: { value: 97, unit: "%", system: "http://unitsofmeasure.org" },
        }),
      ],
    }),
  },
  {
    key: "vitals-imperial",
    label: "Vitals + Labs — imperial units",
    description:
      "Weight recorded in pounds (legacy EMR export) — exercises the UCUM lb→kg normaliser before SDTM grounding.",
    build: (pid) => ({
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        patientResource(pid),
        obs("29463-7", "Body Weight", {
          valueQuantity: { value: 154.3, unit: "lb", system: "http://unitsofmeasure.org" },
        }),
        obs("8302-2", "Body Height", {
          valueQuantity: { value: 67, unit: "in", system: "http://unitsofmeasure.org" },
        }),
        obs("9843-4", "Body Temperature", {
          valueQuantity: { value: 98.6, unit: "F", system: "http://unitsofmeasure.org" },
        }),
        obs("4548-4", "Hemoglobin A1c", {
          valueQuantity: { value: 5.6, unit: "%", system: "http://unitsofmeasure.org" },
        }),
      ],
    }),
  },
  {
    key: "ayush-full",
    label: "Vitals + Ayush CRF extension",
    description:
      "Full integrative visit: vitals plus the Ministry of Ayush clinical-diagnostics extension (Prakriti, Agni, Koshtha) which routes to the MongoDB CRF store.",
    build: (pid) => ({
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        patientResource(pid),
        obs("29463-7", "Body Weight", {
          valueQuantity: { value: 68.5, unit: "kg", system: "http://unitsofmeasure.org" },
        }),
        obs("8480-6", "Systolic Blood Pressure", {
          valueQuantity: { value: 124, unit: "mmHg", system: "http://unitsofmeasure.org" },
        }),
        obs("8462-4", "Diastolic Blood Pressure", {
          valueQuantity: { value: 78, unit: "mmHg", system: "http://unitsofmeasure.org" },
        }),
        {
          resource: {
            resourceType: "Observation",
            status: "final",
            visitNumber: 3,
            code: {
              coding: [
                {
                  system: "https://nrces.in/standards/ayush/CodeSystem/clinical-diagnostics",
                  code: "AYUSH-CRF",
                  display: "Ayurvedic Clinical Diagnostics",
                },
              ],
            },
            extension: [
              {
                url: AYUSH_EXT_URL,
                valueObject: {
                  prakriti: { primary: "Pitta", secondary: "Vata", score: 6.5 },
                  agni: { state: "Vishama" },
                  koshtha: { state: "Madhyama" },
                },
              },
            ],
          },
        },
      ],
    }),
  },
];

export function randomDoshaTriplet(): {
  prakriti: { primary: Dosha; secondary: Dosha | "None"; score: number };
  agni: AgniState;
  koshtha: KoshthaState;
} {
  const doshas: Dosha[] = ["Vata", "Pitta", "Kapha"];
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const primary = pick(doshas);
  let secondary: Dosha | "None" = pick(doshas);
  if (secondary === primary) secondary = "None";
  return {
    prakriti: {
      primary,
      secondary,
      score: Math.round((Math.random() * 6 + 3) * 10) / 10,
    },
    agni: pick<AgniState>(["Manda", "Teekshna", "Vishama", "Sama"]),
    koshtha: pick<KoshthaState>(["Mridu", "Madhyama", "Kroora"]),
  };
}
