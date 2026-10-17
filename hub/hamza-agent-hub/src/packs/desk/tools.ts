/** Automation Desk tools — local implementation matching desk.imdifferent01.com */

export function cleanLeads(input: { text?: string; csv?: string }): {
  emails: string[];
  count: number;
  duplicates_removed: number;
} {
  const raw = `${input.text || ''}\n${input.csv || ''}`;
  const found = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const normalized = found.map((e) => e.trim().toLowerCase());
  const unique = [...new Set(normalized)].sort();
  return {
    emails: unique,
    count: unique.length,
    duplicates_removed: normalized.length - unique.length,
  };
}

export function sheetsToJson(input: { csv: string; dialect?: string }): {
  rows: Record<string, string>[];
  columns: string[];
  count: number;
} {
  const text = input.csv.replace(/^\uFEFF/, '');
  const delim = input.dialect === 'tsv' || text.includes('\t') ? '\t' : ',';
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], columns: [], count: 0 };
  const columns = splitLine(lines[0]!, delim);
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line, delim);
    const row: Record<string, string> = {};
    columns.forEach((col, i) => {
      row[col] = cells[i] ?? '';
    });
    return row;
  });
  return { rows, columns, count: rows.length };
}

export function extractContacts(input: { html?: string; url?: string }): {
  emails: string[];
  phones: string[];
  social: string[];
  source_url: string | null;
} {
  const html = input.html || '';
  const emails = [...new Set((html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((e) => e.toLowerCase()))];
  const phones = [...new Set(html.match(/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3}[\s-]?\d{3,4}/g) || [])];
  const socialPatterns = [
    /https?:\/\/(?:www\.)?(?:linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|github\.com)\/[^\s"'<>]+/gi,
  ];
  const social: string[] = [];
  for (const re of socialPatterns) {
    for (const m of html.match(re) || []) social.push(m);
  }
  return {
    emails,
    phones,
    social: [...new Set(social)],
    source_url: input.url || null,
  };
}

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === delim && !inQuotes) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}
