import { EXIT_CODE, GhqvError } from '../domain/errors';

export interface ManagedMarkers {
  begin: string;
  end: string;
}

export interface ManagedBlockResult {
  content: string; // full file content after replacement
  changed: boolean;
}

export function replaceManagedBlock(
  existing: string | null,
  markers: ManagedMarkers,
  innerContent: string,
): ManagedBlockResult {
  const block = `${markers.begin}\n${innerContent}\n${markers.end}`;
  if (existing === null) {
    return { content: `${block}\n`, changed: true };
  }
  const beginIdx = existing.indexOf(markers.begin);
  const endIdx = existing.indexOf(markers.end);
  if (beginIdx === -1 && endIdx === -1) {
    // no markers: preserve existing content, append block
    const sep = existing.endsWith('\n') ? '' : '\n';
    const content = `${existing}${sep}\n${block}\n`;
    return { content, changed: true };
  }
  // validate exactly one pair, begin before end
  const beginCount = countOccurrences(existing, markers.begin);
  const endCount = countOccurrences(existing, markers.end);
  if (beginCount !== 1 || endCount !== 1 || beginIdx > endIdx) {
    throw new GhqvError(
      'GHQV_MANAGED_BLOCK_INVALID',
      'managed markers are malformed in file',
      EXIT_CODE.CONFLICT,
    );
  }
  const before = existing.slice(0, beginIdx);
  const after = existing.slice(endIdx + markers.end.length);
  const newContent = `${before}${block}${after}`;
  const normalized = ensureTrailingNewline(newContent);
  return { content: normalized, changed: normalized !== existing };
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    count++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return count;
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s : `${s}\n`;
}

export const MD_MARKERS: ManagedMarkers = {
  begin: '<!-- ghqv:begin -->',
  end: '<!-- ghqv:end -->',
};

export const GITIGNORE_MARKERS: ManagedMarkers = {
  begin: '# ghqv:begin',
  end: '# ghqv:end',
};

export function extractManagedBlock(content: string, markers: ManagedMarkers): string | null {
  const beginIdx = content.indexOf(markers.begin);
  const endIdx = content.indexOf(markers.end);
  if (beginIdx === -1 || endIdx === -1 || beginIdx > endIdx) return null;
  return content.slice(beginIdx + markers.begin.length, endIdx);
}
