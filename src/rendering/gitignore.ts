import type { NormalizedManifest } from '../domain/manifest';
import { GITIGNORE_MARKERS, replaceManagedBlock } from './managed-block';

export function renderGitignore(
  manifest: NormalizedManifest,
  existing: string | null,
): { content: string; changed: boolean } {
  const lines = ['# Materialized repositories managed by ghqv.'];
  for (const r of manifest.repositories) {
    lines.push(`/${r.path}`);
  }
  return replaceManagedBlock(existing, GITIGNORE_MARKERS, lines.join('\n'));
}
