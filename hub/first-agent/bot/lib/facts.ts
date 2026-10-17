export const FACTS_KEY = "facts";
export const MAX_FACTS = 50;

export type Fact = {
  text: string;
  savedAt: string;
};

export type FactJournal = {
  facts: Fact[];
};

export function readJournal(value: unknown): Fact[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const record = value as { facts?: unknown };
  if (!Array.isArray(record.facts)) {
    return [];
  }
  const parsed: Fact[] = [];
  for (const item of record.facts) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const fact = item as { text?: unknown; savedAt?: unknown };
    if (typeof fact.text !== "string") {
      continue;
    }
    const text = fact.text.trim();
    if (text === "") {
      continue;
    }
    parsed.push({
      text,
      savedAt: typeof fact.savedAt === "string" ? fact.savedAt : "",
    });
  }
  return parsed.slice(-MAX_FACTS);
}

export function toJournal(facts: Fact[]): FactJournal {
  return { facts: facts.slice(-MAX_FACTS) };
}
