export interface Column {
  name: string;
  width: number;
}

export function renderTable(columns: Column[], rows: string[][]): string {
  const header = columns.map((c) => pad(c.name, c.width)).join('  ');
  const sep = columns.map((c) => '-'.repeat(c.width)).join('  ');
  const body = rows
    .map((row) => row.map((cell, i) => pad(cell, columns[i]?.width ?? 0)).join('  '))
    .join('\n');
  return [header, sep, body].filter(Boolean).join('\n');
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}
