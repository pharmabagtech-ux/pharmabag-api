/**
 * FAQ rows stored on `master_products.faq`.
 *
 * Not every stored value is trustworthy. Rows written before the DTO carried
 * `@Type()` were flattened by the global pipe (see ProductFaqEntryDto) and sit
 * in the column as `[[], []]` — one empty array per question the admin typed.
 * The product page maps over them and calls applyTokens(f.question), which
 * throws on `undefined`, so a single bad row takes the whole page down rather
 * than merely hiding an FAQ. Reads and writes both go through here.
 */
export interface ProductFaqEntry {
  question: string;
  answer: string;
}

/** The rows that carry both a question and an answer, in order. */
export function validFaqEntries(faq: unknown): ProductFaqEntry[] {
  if (!Array.isArray(faq)) return [];
  return faq.filter(
    (f): f is ProductFaqEntry =>
      !!f &&
      typeof f === 'object' &&
      !Array.isArray(f) &&
      typeof (f as { question?: unknown }).question === 'string' &&
      (f as { question: string }).question.trim() !== '' &&
      typeof (f as { answer?: unknown }).answer === 'string' &&
      (f as { answer: string }).answer.trim() !== '',
  );
}

/** Trimmed rows ready to store, or null when the admin cleared the FAQ. */
export function faqForStorage(faq: unknown): ProductFaqEntry[] | null {
  const clean = validFaqEntries(faq).map((f) => ({
    question: f.question.trim(),
    answer: f.answer.trim(),
  }));
  return clean.length ? clean : null;
}
