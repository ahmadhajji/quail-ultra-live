export type ExamToolKey = 'notes' | 'lab-values' | 'calculator'

export interface LabValueRow {
  label: string
  conventional: string
  si: string
  keywords?: string[]
}

export interface LabValueSection {
  id: string
  title: string
  subtitle: string
  rows: LabValueRow[]
}

// Standard exam-style reference ranges are based on the NBME laboratory values sheet.
export const LAB_VALUE_SECTIONS: LabValueSection[] = [
  {
    id: 'serum-electrolytes',
    title: 'Serum: Electrolytes and Renal',
    subtitle: 'High-yield chemistry values used constantly in question stems.',
    rows: [
      { label: 'Sodium (Na+)', conventional: '136-146 mEq/L', si: '136-146 mmol/L', keywords: ['na', 'natremia'] },
      { label: 'Potassium (K+)', conventional: '3.5-5.0 mEq/L', si: '3.5-5.0 mmol/L', keywords: ['k', 'kalemia'] },
      { label: 'Chloride (Cl-)', conventional: '95-105 mEq/L', si: '95-105 mmol/L' },
      { label: 'Bicarbonate (HCO3-)', conventional: '22-28 mEq/L', si: '22-28 mmol/L', keywords: ['co2'] },
      { label: 'Urea nitrogen (BUN)', conventional: '7-18 mg/dL', si: '2.5-6.4 mmol/L', keywords: ['bun', 'urea'] },
      { label: 'Creatinine', conventional: '0.6-1.2 mg/dL', si: '53-106 umol/L', keywords: ['cr'] },
      { label: 'Glucose, fasting', conventional: '70-100 mg/dL', si: '3.8-5.6 mmol/L', keywords: ['blood sugar'] },
      { label: 'Glucose, random', conventional: '<140 mg/dL', si: '<7.77 mmol/L', keywords: ['blood sugar'] },
      { label: 'Calcium', conventional: '8.4-10.2 mg/dL', si: '2.1-2.6 mmol/L' },
      { label: 'Magnesium', conventional: '1.5-2.0 mg/dL', si: '0.75-1.0 mmol/L', keywords: ['mg'] },
      { label: 'Phosphorus', conventional: '3.0-4.5 mg/dL', si: '1.0-1.5 mmol/L', keywords: ['phosphate'] }
    ]
  },
  {
    id: 'serum-hepatic',
    title: 'Serum: Hepatic and Protein',
    subtitle: 'Core liver chemistry and serum protein ranges.',
    rows: [
      { label: 'ALT', conventional: '10-40 U/L', si: '10-40 U/L', keywords: ['alanine aminotransferase'] },
      { label: 'AST', conventional: '12-38 U/L', si: '12-38 U/L', keywords: ['aspartate aminotransferase'] },
      { label: 'Alkaline phosphatase', conventional: '25-100 U/L', si: '25-100 U/L', keywords: ['alk phos', 'alp'] },
      { label: 'Bilirubin, total', conventional: '0.1-1.0 mg/dL', si: '2-17 umol/L', keywords: ['tbili'] },
      { label: 'Bilirubin, direct', conventional: '0.0-0.3 mg/dL', si: '0-5 umol/L', keywords: ['dbili', 'conjugated bilirubin'] },
      { label: 'Total protein', conventional: '6.0-7.8 g/dL', si: '60-78 g/L' },
      { label: 'Albumin', conventional: '3.5-5.5 g/dL', si: '35-55 g/L' },
      { label: 'Globulin', conventional: '2.3-3.5 g/dL', si: '23-35 g/L' }
    ]
  },
  {
    id: 'serum-other',
    title: 'Serum: Other Common Tests',
    subtitle: 'Frequently cited pancreatic, cardiac, and osmotic markers.',
    rows: [
      { label: 'Amylase', conventional: '25-125 U/L', si: '25-125 U/L' },
      { label: 'Lipase', conventional: '13-60 U/L', si: '13-60 U/L' },
      { label: 'Creatinine clearance, male', conventional: '97-137 mL/min', si: '97-137 mL/min', keywords: ['crcl', 'gfr'] },
      { label: 'Creatinine clearance, female', conventional: '88-128 mL/min', si: '88-128 mL/min', keywords: ['crcl', 'gfr'] },
      { label: 'Creatine kinase, male', conventional: '25-90 U/L', si: '25-90 U/L', keywords: ['ck'] },
      { label: 'Creatine kinase, female', conventional: '10-70 U/L', si: '10-70 U/L', keywords: ['ck'] },
      { label: 'Lactate dehydrogenase', conventional: '45-200 U/L', si: '45-200 U/L', keywords: ['ldh'] },
      { label: 'Osmolality', conventional: '275-295 mOsmol/kg H2O', si: '275-295 mOsmol/kg H2O', keywords: ['osm'] },
      { label: 'Troponin I', conventional: '<=0.04 ng/mL', si: '<=0.04 ug/L', keywords: ['trop'] },
      { label: 'Uric acid', conventional: '3.0-8.2 mg/dL', si: '0.18-0.48 mmol/L' }
    ]
  },
  {
    id: 'metabolic-endocrine',
    title: 'Metabolic and Endocrine',
    subtitle: 'A compact set of high-yield endocrine and iron studies.',
    rows: [
      { label: 'Ferritin, male', conventional: '20-250 ng/mL', si: '20-250 ug/L' },
      { label: 'Ferritin, female', conventional: '10-120 ng/mL', si: '10-120 ug/L' },
      { label: 'Iron, male', conventional: '65-175 ug/dL', si: '11.6-31.3 umol/L' },
      { label: 'Iron, female', conventional: '50-170 ug/dL', si: '9.0-30.4 umol/L' },
      { label: 'Total iron-binding capacity', conventional: '250-400 ug/dL', si: '44.8-71.6 umol/L', keywords: ['tibc'] },
      { label: 'Hemoglobin A1c', conventional: '<=6%', si: '<=42 mmol/mol', keywords: ['a1c', 'hba1c'] },
      { label: 'TSH', conventional: '0.4-4.0 uU/mL', si: '0.4-4.0 mIU/L', keywords: ['thyroid stimulating hormone'] },
      { label: 'Free T4', conventional: '0.9-1.7 ng/dL', si: '12.0-21.9 pmol/L' },
      { label: 'Cortisol, 0800 h', conventional: '5-23 ug/dL', si: '138-635 nmol/L' },
      { label: 'Cortisol, 1600 h', conventional: '3-15 ug/dL', si: '82-413 nmol/L' }
    ]
  },
  {
    id: 'hematology',
    title: 'Hematology',
    subtitle: 'CBC, differentials, and common marrow-related values.',
    rows: [
      { label: 'Hematocrit, male', conventional: '41-53%', si: '0.41-0.53' },
      { label: 'Hematocrit, female', conventional: '36-46%', si: '0.36-0.46' },
      { label: 'Hemoglobin, male', conventional: '13.5-17.5 g/dL', si: '135-175 g/L' },
      { label: 'Hemoglobin, female', conventional: '12.0-16.0 g/dL', si: '120-160 g/L' },
      { label: 'MCV', conventional: '80-100 fL', si: '80-100 fL', keywords: ['mean corpuscular volume'] },
      { label: 'MCH', conventional: '25-35 pg/cell', si: '0.39-0.54 fmol/cell' },
      { label: 'MCHC', conventional: '31-36% Hb/cell', si: '4.8-5.6 mmol Hb/L' },
      { label: 'WBC', conventional: '4,500-11,000/mm3', si: '4.5-11.0 x 10^9/L', keywords: ['leukocyte'] },
      { label: 'Neutrophils, segmented', conventional: '54-62%', si: '0.54-0.62' },
      { label: 'Neutrophils, bands', conventional: '3-5%', si: '0.03-0.05' },
      { label: 'Lymphocytes', conventional: '25-33%', si: '0.25-0.33' },
      { label: 'Monocytes', conventional: '3-7%', si: '0.03-0.07' },
      { label: 'Eosinophils', conventional: '1-3%', si: '0.01-0.03' },
      { label: 'Basophils', conventional: '0-0.75%', si: '0.00-0.0075' },
      { label: 'Platelets', conventional: '150,000-400,000/mm3', si: '150-400 x 10^9/L', keywords: ['plt'] },
      { label: 'Reticulocyte count', conventional: '0.5-1.5%', si: '0.005-0.015', keywords: ['retic'] },
      { label: 'RBC count, male', conventional: '4.3-5.9 million/mm3', si: '4.3-5.9 x 10^12/L' },
      { label: 'RBC count, female', conventional: '3.5-5.5 million/mm3', si: '3.5-5.5 x 10^12/L' },
      { label: 'ESR, male', conventional: '0-15 mm/h', si: '0-15 mm/h', keywords: ['sed rate'] },
      { label: 'ESR, female', conventional: '0-20 mm/h', si: '0-20 mm/h', keywords: ['sed rate'] },
      { label: 'CD4+ T-lymphocyte count', conventional: '>=500/mm3', si: '>=0.5 x 10^9/L', keywords: ['cd4'] }
    ]
  },
  {
    id: 'coagulation',
    title: 'Coagulation',
    subtitle: 'Core hemostasis screening values.',
    rows: [
      { label: 'PTT / aPTT', conventional: '25-40 sec', si: '25-40 sec', keywords: ['partial thromboplastin time'] },
      { label: 'PT', conventional: '11-15 sec', si: '11-15 sec', keywords: ['prothrombin time'] },
      { label: 'D-dimer', conventional: '<=250 ng/mL', si: '<=1.4 nmol/L' }
    ]
  },
  {
    id: 'abg',
    title: 'Arterial Blood Gas',
    subtitle: 'Room-air arterial blood reference ranges.',
    rows: [
      { label: 'PaO2', conventional: '75-105 mm Hg', si: '10.0-14.0 kPa', keywords: ['po2'] },
      { label: 'PaCO2', conventional: '33-45 mm Hg', si: '4.4-5.9 kPa', keywords: ['pco2'] },
      { label: 'pH', conventional: '7.35-7.45', si: '[H+] 36-44 nmol/L' }
    ]
  },
  {
    id: 'csf',
    title: 'Cerebrospinal Fluid',
    subtitle: 'Quick CSF reference values for meningitis and neuro questions.',
    rows: [
      { label: 'Cell count', conventional: '0-5/mm3', si: '0-5 x 10^6/L' },
      { label: 'Chloride', conventional: '118-132 mEq/L', si: '118-132 mmol/L' },
      { label: 'Gamma globulin', conventional: '3-12% total proteins', si: '0.03-0.12' },
      { label: 'Glucose', conventional: '40-70 mg/dL', si: '2.2-3.9 mmol/L' },
      { label: 'Pressure', conventional: '70-180 mm H2O', si: '70-180 mm H2O' },
      { label: 'Total protein', conventional: '<40 mg/dL', si: '<0.40 g/L' }
    ]
  },
  {
    id: 'urine',
    title: 'Urine',
    subtitle: 'Common urine chemistry ranges.',
    rows: [
      { label: 'Calcium', conventional: '100-300 mg/24 h', si: '2.5-7.5 mmol/24 h' },
      { label: 'Osmolality', conventional: '50-1200 mOsmol/kg H2O', si: '50-1200 mOsmol/kg H2O' },
      { label: 'Oxalate', conventional: '8-40 ug/mL', si: '90-445 umol/L' },
      { label: 'Total protein', conventional: '<150 mg/24 h', si: '<0.15 g/24 h' }
    ]
  }
]
