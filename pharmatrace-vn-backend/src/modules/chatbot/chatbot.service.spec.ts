import { ConfigService } from '@nestjs/config';
import { ChatbotService } from './chatbot.service';
import { GeminiClient } from './gemini.client';
import { MedicineIndexService } from './medicine-index.service';
import { buildMedicineDoc, MedicineDoc } from './medicine-knowledge';
import { hasRedFlag, MEDICAL_DISCLAIMER } from './red-flags';
import { SlidingWindowLimiter } from './rate-limiter';
import { VectorIndex } from './vector-index';

const doc = (id: number, name: string, rx = false): MedicineDoc => ({
  id, name, slug: `slug-${id}`, imageUrl: null, price: 10000, requiresPrescription: rx, embedText: name, contextText: `[ID ${id}] ${name}`,
});

function setup(retrieved: MedicineDoc[], modelOutput: unknown) {
  const gemini = {
    embed: jest.fn().mockResolvedValue([[1, 0]]),
    generateJson: jest.fn().mockResolvedValue(modelOutput),
  };
  const index = {
    ensureReady: jest.fn().mockResolvedValue(undefined),
    search: jest.fn().mockReturnValue(retrieved.map((d) => ({ doc: d, score: 0.8 }))),
  };
  const service = new ChatbotService(gemini as unknown as GeminiClient, index as unknown as MedicineIndexService, new ConfigService({}));
  return { service, gemini, index };
}

describe('ChatbotService', () => {
  it('answers emergencies deterministically without retrieval or the model', async () => {
    const { service, gemini, index } = setup([], {});
    const reply = await service.ask({ message: 'I have chest pain and I can\x27t breathe' });
    expect(reply.emergency).toBe(true);
    expect(reply.needsDoctor).toBe(true);
    expect(reply.products).toEqual([]);
    expect(gemini.embed).not.toHaveBeenCalled();
    expect(gemini.generateJson).not.toHaveBeenCalled();
    expect(index.search).not.toHaveBeenCalled();
  });

  it('returns only recommendations that were retrieved and drops hallucinated or duplicate ids', async () => {
    const { service } = setup([doc(1, 'Paracetamol 500mg'), doc(2, 'Oresol')], {
      answer: 'You could use Paracetamol.',
      recommendations: [
        { medicineId: 1, reason: 'Reduces fever' },
        { medicineId: 999, reason: 'made up' },
        { medicineId: 1, reason: 'duplicate' },
      ],
      followUpQuestions: [{ question: 'How old are you?', topic: 'age' }],
      needsDoctor: false,
    });
    const reply = await service.ask({ message: 'I have a mild fever' });
    expect(reply.products.map((p) => p.id)).toEqual([1]);
    expect(reply.products[0].reason).toBe('Reduces fever');
    expect(reply.followUpQuestions).toEqual(['How old are you?']);
    expect(reply.disclaimer).toBe(MEDICAL_DISCLAIMER);
  });

  it('forces needsDoctor when a prescription-only product is suggested', async () => {
    const { service } = setup([doc(5, 'Stablon', true)], {
      answer: 'x', recommendations: [{ medicineId: 5, reason: 'r' }], followUpQuestions: [], needsDoctor: false,
    });
    const reply = await service.ask({ message: 'I feel low and cannot sleep' });
    expect(reply.products[0].requiresPrescription).toBe(true);
    expect(reply.needsDoctor).toBe(true);
  });

  it('caps recommendations at three', async () => {
    const docs = [1, 2, 3, 4, 5].map((i) => doc(i, `M${i}`));
    const { service } = setup(docs, {
      answer: 'x', recommendations: docs.map((d) => ({ medicineId: d.id, reason: 'r' })), followUpQuestions: [], needsDoctor: false,
    });
    expect((await service.ask({ message: 'headache' })).products).toHaveLength(3);
  });

  it('puts retrieved context in the newest user turn and embeds earlier user turns with the question', async () => {
    const { service, gemini } = setup([doc(1, 'Paracetamol')], { answer: 'ok', recommendations: [], followUpQuestions: [], needsDoctor: false });
    await service.ask({
      message: 'what about children?',
      history: [
        { role: 'user', content: 'I have a fever' },
        { role: 'assistant', content: 'How old are you?' },
      ],
    });
    expect(gemini.embed.mock.calls[0][0][0]).toBe('I have a fever\nwhat about children?');
    const turns = gemini.generateJson.mock.calls[0][0].turns;
    expect(turns.map((t: { role: string }) => t.role)).toEqual(['user', 'model', 'user']);
    expect(turns[2].text).toContain('[ID 1] Paracetamol');
    expect(turns[2].text).toContain('what about children?');
  });

  it('drops follow-up questions that were already asked, have no valid topic, or exceed three', async () => {
    const { service } = setup([doc(1, 'Paracetamol')], {
      answer: 'ok',
      recommendations: [],
      followUpQuestions: [
        { question: 'Are you pregnant or breastfeeding?', topic: 'pregnancy_breastfeeding' },
        { question: 'How many days have you had the fever?', topic: 'symptom_duration' },
        { question: 'What is your favourite colour?', topic: 'small_talk' },
        { question: 'Do you take warfarin or other blood thinners?', topic: 'current_medication' },
        { question: 'Do you have liver or kidney disease?', topic: 'chronic_condition' },
        { question: 'Are you allergic to paracetamol?', topic: 'allergy' },
      ],
      needsDoctor: false,
    });
    const reply = await service.ask({
      message: 'I am 30 and it is a headache',
      history: [
        { role: 'user', content: 'fever' },
        { role: 'assistant', content: 'I need a little more information. Are you pregnant, or breastfeeding?' },
      ],
    });
    expect(reply.followUpQuestions).toEqual([
      'How many days have you had the fever?',
      'Do you take warfarin or other blood thinners?',
      'Do you have liver or kidney disease?',
    ]);
  });

  it('falls back to a safe answer when the model returns nothing usable', async () => {
    const { service } = setup([], {});
    const reply = await service.ask({ message: 'hello' });
    expect(reply.answer).toMatch(/couldn't find a suitable product/);
    expect(reply.products).toEqual([]);
  });
});

describe('red flags', () => {
  it.each([
    'I have chest pain',
    "I can't breathe properly",
    'my son is having a seizure',
    'she fainted and is unresponsive',
    'I keep vomiting blood',
    'I think I overdosed on paracetamol',
    'I want to kill myself',
    'my lips and tongue are swelling after the pills',
    'my newborn has a fever',
    'my daughter had a convulsion',
    'CHEST PAIN right now',
  ])('flags: %s', (m) => expect(hasRedFlag(m)).toBe(true));

  it.each(['I have a runny nose and a stuffy nose', 'mild headache and a slight fever', 'dry cough for a few days', 'sore throat', 'what is the maximum dose of ibuprofen?', 'my nose is blocked and I keep sneezing'])('does not flag: %s', (m) =>
    expect(hasRedFlag(m)).toBe(false),
  );
});

describe('buildMedicineDoc', () => {
  const record = {
    id: 7, medicine_name: 'Paralmax', slug: 'paralmax', image_url: null, effective_price: '10800.00', unit_price: '13333.00',
    is_prescription: false, active_ingredients: null, short_description: 'short', categories: ['Cold & Flu'],
    details: {
      indications: ['Fever', 'Nasal congestion'],
      detailedIngredients: { activeIngredients: 'Paracetamol 500mg' },
      usageInstructions: { dosage: '1-2 tablets per dose' },
      contraindications: 'Allergy to paracetamol',
      specialPatientGroups: { pregnancy: 'Not recommended' },
      drugInteractions: [{ drug: 'Warfarin', effect: 'x' }],
    },
  };

  it('builds an indication-focused embed text and a grounded context text', () => {
    const d = buildMedicineDoc(record);
    expect(d.price).toBe(10800);
    expect(d.embedText).toContain('Used for: Fever; Nasal congestion');
    expect(d.embedText).toContain('Category: Cold & Flu');
    expect(d.contextText).toContain('[ID 7] Paralmax');
    expect(d.contextText).toContain('Requires prescription: no');
    expect(d.contextText).toContain('Dosage (from leaflet): 1-2 tablets per dose');
    expect(d.contextText).toContain('Contraindications: Allergy to paracetamol');
    expect(d.contextText).toContain('Interacts with: Warfarin');
  });

  it('tolerates missing or odd details', () => {
    const d = buildMedicineDoc({ ...record, details: null, effective_price: null, unit_price: null, is_prescription: true });
    expect(d.price).toBe(0);
    expect(d.requiresPrescription).toBe(true);
    expect(d.contextText).toContain('Requires prescription: YES');
  });
});

describe('VectorIndex', () => {
  it('ranks by cosine similarity and applies the minimum score', () => {
    const index = new VectorIndex();
    index.set(1, [1, 0]);
    index.set(2, [0.6, 0.8]);
    index.set(3, [0, 1]);
    expect(index.search([1, 0], 2, 0).map((h) => h.id)).toEqual([1, 2]);
    expect(index.search([1, 0], 5, 0.5).map((h) => h.id)).toEqual([1, 2]);
    index.delete(1);
    expect(index.search([1, 0], 5, 0.5).map((h) => h.id)).toEqual([2]);
  });
});

describe('SlidingWindowLimiter', () => {
  it('allows up to the limit inside the window and recovers afterwards', () => {
    const limiter = new SlidingWindowLimiter(2, 1000);
    expect(limiter.tryConsume('a', 0)).toBe(true);
    expect(limiter.tryConsume('a', 100)).toBe(true);
    expect(limiter.tryConsume('a', 200)).toBe(false);
    expect(limiter.tryConsume('b', 200)).toBe(true);
    expect(limiter.tryConsume('a', 1101)).toBe(true);
  });
});
