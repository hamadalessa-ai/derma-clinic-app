/**
 * Common tests in a skin / hair / dental clinic, with usual adult units and ranges. Only
 * suggestions to fill a row faster: the range printed on the lab's own report always wins.
 */
export const LAB_PRESETS: { name: string; unit: string; low?: number; high?: number }[] = [
  { name: "Hemoglobin", unit: "g/dL", low: 12, high: 17.5 },
  { name: "WBC", unit: "10^9/L", low: 4, high: 11 },
  { name: "Platelets", unit: "10^9/L", low: 150, high: 400 },
  { name: "Ferritin", unit: "ng/mL", low: 30, high: 400 },
  { name: "Vitamin D (25-OH)", unit: "ng/mL", low: 30, high: 100 },
  { name: "Vitamin B12", unit: "pg/mL", low: 200, high: 900 },
  { name: "Zinc", unit: "µg/dL", low: 60, high: 120 },
  { name: "TSH", unit: "mIU/L", low: 0.4, high: 4 },
  { name: "Free T4", unit: "ng/dL", low: 0.8, high: 1.8 },
  { name: "ALT", unit: "U/L", low: 7, high: 56 },
  { name: "AST", unit: "U/L", low: 10, high: 40 },
  { name: "Total cholesterol", unit: "mg/dL", high: 200 },
  { name: "Triglycerides", unit: "mg/dL", high: 150 },
  { name: "HbA1c", unit: "%", high: 5.7 },
  { name: "Fasting glucose", unit: "mg/dL", low: 70, high: 100 },
  { name: "Total testosterone", unit: "ng/dL" },
  { name: "DHEA-S", unit: "µg/dL" },
  { name: "Prolactin", unit: "ng/mL" },
  { name: "ANA", unit: "" },
  { name: "Pregnancy test (β-hCG)", unit: "" },
  { name: "Hepatitis B (HBsAg)", unit: "" },
  { name: "Hepatitis C (anti-HCV)", unit: "" },
  { name: "HIV", unit: "" },
];
