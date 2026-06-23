import type { LocalState } from './local-state';
import type { NormalizedManifest } from './manifest';
import type { DestinationKind, ObservedRepository } from './repository';

export interface ObservedWorkspace {
  manifest: NormalizedManifest;
  repositories: ObservedRepository[];
  orphanedState: { name: string; state: import('./repository').ManagedRepositoryState }[];
}

export function destinationKindFromEntry(
  kind: 'missing' | 'symlink' | 'file' | 'directory' | 'other',
): DestinationKind {
  return kind;
}

export function isOrphaned(name: string, manifest: NormalizedManifest): boolean {
  return !manifest.repositories.some((r) => r.name === name);
}

export function collectOrphans(state: LocalState, manifest: NormalizedManifest) {
  const known = new Set(manifest.repositories.map((r) => r.name));
  const orphans: { name: string; state: import('./repository').ManagedRepositoryState }[] = [];
  for (const [name, entry] of Object.entries(state.repositories)) {
    if (!known.has(name)) orphans.push({ name, state: entry });
  }
  return orphans;
}
