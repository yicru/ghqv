import type { NormalizedManifest } from '../domain/manifest';
import { MD_MARKERS, replaceManagedBlock } from './managed-block';

function escCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

export function renderAgentsManagedBlock(manifest: NormalizedManifest): string {
  const lines: string[] = [];
  lines.push(`# ${manifest.workspace.name} Virtual Workspace — System Map`);
  lines.push('');
  lines.push('## Purpose');
  lines.push('');
  lines.push(
    'This directory is a virtual workspace containing multiple independent Git repositories.',
  );
  lines.push('It is not a single deployable or committable unit.');
  lines.push('');
  lines.push('## Repository Map');
  lines.push('');
  lines.push('| Directory | Repository | Role | Tech |');
  lines.push('|---|---|---|---|');
  for (const r of manifest.repositories) {
    const tech = r.tech.length > 0 ? r.tech.join(', ') : '—';
    const role = r.role ?? '—';
    lines.push(`| \`${r.path}/\` | \`${r.source}\` | ${escCell(role)} | ${escCell(tech)} |`);
  }
  lines.push('');
  lines.push('## Dependencies');
  lines.push('');
  const deps = manifest.repositories.filter((r) => r.dependsOn.length > 0);
  if (deps.length === 0) {
    lines.push('No declared cross-repository dependencies.');
  } else {
    for (const r of deps) {
      lines.push(`- \`${r.name}\` depends on ${r.dependsOn.map((d) => `\`${d}\``).join(', ')}.`);
    }
  }
  lines.push('');
  lines.push('## Cross-repository rules');
  lines.push('');
  lines.push('- Treat each linked directory as an independent Git repository.');
  lines.push('- Run tests in every affected repository.');
  lines.push('- Before changing an API or schema, inspect repositories that depend on it.');
  lines.push('- Do not assume one commit can atomically cover multiple repositories.');
  lines.push('- Read `architecture/` for system-wide decisions.');
  return lines.join('\n');
}

export function renderAgents(
  manifest: NormalizedManifest,
  existing: string | null,
): { content: string; changed: boolean } {
  return replaceManagedBlock(existing, MD_MARKERS, renderAgentsManagedBlock(manifest));
}

export function agentsLineCount(manifest: NormalizedManifest): number {
  return renderAgentsManagedBlock(manifest).split('\n').length;
}
