/**
 * Deterministic emergency screen that runs before any model call. A match skips the model entirely
 * so a life-threatening message can never be answered with a product suggestion.
 */

export function stripDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

const RED_FLAG_PATTERNS: RegExp[] = [
  // English
  /chest (pain|tightness|pressure)|pain in (my |the )?chest|tight(ness)? (in|of) (my |the )?chest/, // chest pain
  /(trouble|difficulty|hard to|struggling to) breath|can'?t breathe|cannot breathe|short(ness)? of breath|choking/, // breathing difficulty
  /faint(ed|ing)|passed out|unconscious|unresponsive|loss of consciousness|blacked out/, // fainting / unconscious
  /seizure|convulsion/, // seizure
  /stroke|face drooping|slurred speech|sudden (numbness|weakness)|paralys|paralyz/, // stroke signs
  /(vomit|cough|spit|pass)\w*.{0,15}blood|blood in (my |the )?(stool|urine|vomit)|bleeding (heavily|a lot|profusely|that (will not|won'?t) stop|won'?t stop)/, // blood loss
  /anaphyla|(lips|face|tongue|throat).{0,12}swell|swelling (of|in) (the |my )?(lips|face|tongue|throat)/, // anaphylaxis
  /overdos(ed|ing)|(took|taken|swallowed|ingested|drank).{0,25}(too (much|many)|an overdose)|poisoned|poison control/, // overdose / poisoning
  /suicid|kill myself|end my life|want to die|self[- ]harm|hurt myself/, // self-harm
  /heart attack/, // named directly
  /(newborn|infant|baby (under|younger|less)).{0,40}(fever|not feeding|lethargic|limp)/, // young infant
  // Vietnamese (kept so the screen still works if someone types in Vietnamese)
  /dau (nguc|that nguc)/, // chest pain
  /(kho tho|tho khong (duoc|noi)|ngat tho|nghet tho)/, // breathing difficulty
  /(ngat xiu|bat tinh|hon me|ngat di|mat y thuc|lu lan)/, // fainting / unconscious
  /(co giat|dong kinh)/, // seizure
  /(liet|meo mieng|noi ngong|noi khong ro|yeu mot ben)/, // stroke signs
  /(non|ho|dai|di ngoai).{0,12}ra mau/, // vomiting / coughing / passing blood
  /(chay mau|xuat huyet).{0,15}(nhieu|khong (cam|ngung|dung))/, // heavy bleeding
  /(phan ve|sung (moi|mat|luoi|hong)|nghen co)/, // anaphylaxis
  /(uong|nuot|dung).{0,12}qua lieu|ngo doc thuoc|ngo doc cap/, // overdose / poisoning
  /(tu tu|tu sat|tu hai|muon chet|khong muon song|ket thuc cuoc song)/, // self-harm
  /(dot quy|nhoi mau co tim|dau tim)/, // stroke / heart attack named directly
  /(tre so sinh|be duoi [0-9]+ thang).{0,25}(sot|bo bu|li bi)/, // young infant with fever
];

export function hasRedFlag(message: string): boolean {
  const text = stripDiacritics(message);
  return RED_FLAG_PATTERNS.some((p) => p.test(text));
}

export const EMERGENCY_ANSWER =
  "What you describe could be a medical emergency and needs urgent care. " +
  "Please call 115 (emergency services in Vietnam) or go to the nearest hospital right now. Do not try to treat this yourself with over-the-counter products, and do not wait. " +
  "If someone is with you, ask them to stay with you and help you get there.";

export const MEDICAL_DISCLAIMER =
  "This information is for reference only and does not replace the diagnosis or advice of a doctor or pharmacist. " +
  "Read the product leaflet carefully and ask a pharmacist before using any medicine.";
