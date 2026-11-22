/** Turns a `medicines` row into the two texts the assistant needs: one to embed, one to show the model. */

export interface MedicineRecord {
  id: number;
  medicine_name: string;
  slug: string | null;
  image_url: string | null;
  effective_price: unknown;
  unit_price: unknown;
  is_prescription: boolean | null;
  active_ingredients: string | null;
  short_description: string | null;
  details: unknown;
  categories: string[];
}

export interface MedicineDoc {
  id: number;
  name: string;
  slug: string | null;
  imageUrl: string | null;
  price: number;
  requiresPrescription: boolean;
  /** Compact, indication-focused text used for the vector. */
  embedText: string;
  /** Richer text handed to the model as grounding. */
  contextText: string;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
  if (typeof v === 'string' && v.trim() !== '') return [v.trim()];
  return [];
}

function asText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function interactionDrugs(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x : asText(asRecord(x).drug)))
    .filter((x) => x !== '');
}

function toPrice(...candidates: unknown[]): number {
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export function buildMedicineDoc(record: MedicineRecord): MedicineDoc {
  const d = asRecord(record.details);
  const ingredients =
    asText(asRecord(d.detailedIngredients).activeIngredients) || asText(record.active_ingredients);
  const indications = asList(d.indications);
  const description = asText(d.generalDescription) || asText(record.short_description);
  const dosage = asText(asRecord(d.usageInstructions).dosage) || asText(asRecord(d.usageInstructions).administration);
  const contraindications = asList(d.contraindications);
  const warnings = asList(d.warningsAndPrecautions);
  const groups = asRecord(d.specialPatientGroups);
  const interactions = interactionDrugs(d.drugInteractions);
  const requiresPrescription = Boolean(record.is_prescription);

  const embedText = [
    `Product: ${record.medicine_name}`,
    ingredients && `Active ingredients: ${truncate(ingredients, 300)}`,
    indications.length > 0 && `Used for: ${truncate(indications.join('; '), 700)}`,
    description && `Description: ${truncate(description, 600)}`,
    record.categories.length > 0 && `Category: ${record.categories.join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n');

  const contextText = [
    `[ID ${record.id}] ${record.medicine_name}`,
    `Requires prescription: ${requiresPrescription ? 'YES' : 'no'}`,
    ingredients && `Active ingredients: ${truncate(ingredients, 300)}`,
    indications.length > 0 && `Indications: ${truncate(indications.join('; '), 600)}`,
    !indications.length && description && `Description: ${truncate(description, 500)}`,
    dosage && `Dosage (from leaflet): ${truncate(dosage, 400)}`,
    contraindications.length > 0 && `Contraindications: ${truncate(contraindications.join('; '), 500)}`,
    warnings.length > 0 && `Warnings: ${truncate(warnings.slice(0, 4).join('; '), 500)}`,
    (groups.pregnancy || groups.lactation || groups.pediatric) &&
      `Special groups: pregnancy=${truncate(asText(groups.pregnancy) || 'n/a', 150)}; lactation=${truncate(asText(groups.lactation) || 'n/a', 150)}; children=${truncate(asText(groups.pediatric) || 'n/a', 150)}`,
    interactions.length > 0 && `Interacts with: ${truncate(interactions.slice(0, 8).join(', '), 250)}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    id: record.id,
    name: record.medicine_name,
    slug: record.slug,
    imageUrl: record.image_url,
    price: toPrice(record.effective_price, record.unit_price),
    requiresPrescription,
    embedText,
    contextText,
  };
}
