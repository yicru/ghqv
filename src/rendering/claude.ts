import { MD_MARKERS, replaceManagedBlock } from './managed-block';

export function renderClaude(existing: string | null): { content: string; changed: boolean } {
  return replaceManagedBlock(existing, MD_MARKERS, '@AGENTS.md');
}
