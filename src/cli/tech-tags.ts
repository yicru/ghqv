function normalizeTechTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function parseTechTagsInput(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of raw.split(/[,、]/)) {
    const tag = normalizeTechTag(part);
    if (tag.length === 0 || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

export function formatTechTagsInput(tags: readonly string[]): string {
  return parseTechTagsInput(tags.map(normalizeTechTag).join(', ')).join(', ');
}
