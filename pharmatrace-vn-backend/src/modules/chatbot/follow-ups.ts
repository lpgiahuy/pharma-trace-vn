/**
 * Follow-up questions are only useful when they are about something that changes the advice. The model must
 * tag each question with a topic from this closed list, and the server drops empty, repeated and off-list ones.
 */
export const FOLLOW_UP_TOPICS = [
  'age',
  'pregnancy_breastfeeding',
  'allergy',
  'chronic_condition',
  'current_medication',
  'symptom_duration',
  'symptom_severity',
  'other_symptoms',
  'product_specific_safety',
] as const;

export type FollowUpTopic = (typeof FOLLOW_UP_TOPICS)[number];

export interface RawFollowUp {
  question?: unknown;
  topic?: unknown;
}

const STOP_WORDS = new Set([
  'you', 'your', 'are', 'the', 'and', 'any', 'have', 'has', 'been', 'does', 'did', 'with', 'for', 'that', 'this', 'what', 'how', 'can',
  'please', 'tell', 'let', 'know', 'there', 'from', 'about', 'would', 'could', 'long', 'much', 'many', 'other', 'than', 'also',
]);

function tokens(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP_WORDS.has(w)));
}

/** True when two questions ask essentially the same thing (word overlap, not exact text). */
export function isRepeat(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.6;
}

/** Questions the assistant already asked earlier in this conversation (anything ending in "?"). */
export function previouslyAsked(assistantMessages: string[]): string[] {
  return assistantMessages.flatMap((m) => (m.match(/[^.!?\n]*\?/g) ?? []).map((q) => q.trim()).filter(Boolean));
}

export function selectFollowUps(raw: RawFollowUp[] | undefined, alreadyAsked: string[], max = 3): string[] {
  const kept: string[] = [];
  for (const item of raw ?? []) {
    const question = typeof item?.question === 'string' ? item.question.trim() : '';
    const topic = typeof item?.topic === 'string' ? item.topic : '';
    if (!question || question.length > 200) continue;
    if (!(FOLLOW_UP_TOPICS as readonly string[]).includes(topic)) continue;
    if ([...alreadyAsked, ...kept].some((q) => isRepeat(q, question))) continue;
    kept.push(question);
    if (kept.length >= max) break;
  }
  return kept;
}
