import { isRepeat, previouslyAsked, selectFollowUps } from './follow-ups';

describe('follow-up questions', () => {
  it('treats rephrasings of the same question as repeats but not different questions', () => {
    expect(isRepeat('Are you pregnant or breastfeeding?', 'Are you pregnant, breastfeeding, or taking any other medications?')).toBe(true);
    expect(isRepeat('How many days have you had this headache?', 'How long have you had the headache?')).toBe(true);
    expect(isRepeat('Are you pregnant?', 'Do you have liver or kidney problems?')).toBe(false);
    expect(isRepeat('', 'anything')).toBe(false);
  });

  it('pulls earlier questions out of assistant messages', () => {
    expect(previouslyAsked(['Thanks. What is your age? Are you pregnant? Take care.', 'No question here.'])).toEqual(['What is your age?', 'Are you pregnant?']);
  });

  it('keeps valid, distinct questions in order, up to the limit', () => {
    const out = selectFollowUps(
      [
        { question: 'What is your age?', topic: 'age' },
        { question: 'What is your age, please?', topic: 'age' },
        { question: 'Any liver disease?', topic: 'chronic_condition' },
        { question: 'Any allergies?', topic: 'allergy' },
        { question: 'Do you take blood thinners?', topic: 'current_medication' },
      ],
      [],
    );
    expect(out).toEqual(['What is your age?', 'Any liver disease?', 'Any allergies?']);
  });

  it('rejects missing, off-list, non-string and oversized questions', () => {
    expect(
      selectFollowUps(
        [
          { question: '', topic: 'age' },
          { question: 'Valid wording?', topic: 'made_up' },
          { question: 42, topic: 'age' },
          { question: 'x'.repeat(201), topic: 'age' },
          { topic: 'age' },
        ],
        [],
      ),
    ).toEqual([]);
    expect(selectFollowUps(undefined, [])).toEqual([]);
  });
});
