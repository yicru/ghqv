import type { LocalState } from './local-state';
import type { NormalizedManifest } from './manifest';
import type { DesiredRepository, ResolvedRepository } from './repository';
import type { ObservedRepository } from './repository';
import type { ManagedRepositoryState } from './repository';

export type PlanAction =
  | { type: 'get'; repository: DesiredRepository }
  | { type: 'mkdir'; relativePath: string }
  | { type: 'link'; repository: ResolvedRepository; linkTarget: string }
  | { type: 'adopt'; repository: ResolvedRepository; linkTarget: string }
  | { type: 'relink'; repository: ResolvedRepository; previousTarget: string; linkTarget: string }
  | { type: 'unlink'; name: string; relativePath: string; expectedTarget: string }
  | { type: 'rmdir'; relativePath: string }
  | { type: 'write'; relativePath: string; content: string }
  | { type: 'noop'; name: string; reason: string }
  | { type: 'conflict'; name?: string; code: string; message: string };

export interface SyncPlan {
  actions: PlanAction[];
  conflicts: PlanAction[];
  gets: number;
}

export interface PlanOptions {
  prune: boolean;
  repair: boolean;
}

export type RepositoryState =
  | 'ready'
  | 'missing-source'
  | 'ambiguous-source'
  | 'invalid-source'
  | 'missing-link'
  | 'wrong-link'
  | 'broken-link'
  | 'occupied'
  | 'adoptable'
  | 'orphaned';

export function classifyObserved(obs: ObservedRepository): RepositoryState {
  if (!obs.resolvedSource) {
    return obs.destinationKind === 'missing' ? 'missing-source' : 'missing-source';
  }
  switch (obs.destinationKind) {
    case 'missing':
      return 'missing-link';
    case 'symlink': {
      if (obs.resolvedLinkTarget === obs.resolvedSource.sourceRealPath) {
        return obs.managedState ? 'ready' : 'adoptable';
      }
      if (obs.resolvedLinkTarget === undefined) return 'broken-link';
      return 'wrong-link';
    }
    case 'file':
    case 'directory':
    case 'other':
      return 'occupied';
  }
}

function relativeLinkTarget(destinationPath: string, sourceRealPath: string): string {
  // pure helper for tests: dir-relative path
  const destDir = destinationPath.substring(0, destinationPath.lastIndexOf('/'));
  return relativePath(destDir, sourceRealPath);
}

// simple pure relative path without node:path so domain/plan stays testable
function relativePath(from: string, to: string): string {
  const fromSegs = from.split('/').filter(Boolean);
  const toSegs = to.split('/').filter(Boolean);
  let i = 0;
  while (i < fromSegs.length && i < toSegs.length && fromSegs[i] === toSegs[i]) i++;
  const up = fromSegs.length - i;
  const down = toSegs.slice(i);
  const parts = Array(up).fill('..').concat(down);
  return parts.length === 0 ? '.' : parts.join('/');
}

export function computeLinkTarget(destinationPath: string, sourceRealPath: string): string {
  return relativeLinkTarget(destinationPath, sourceRealPath);
}

interface ResolveInput {
  observed: ObservedRepository[];
  state: LocalState;
  manifest: NormalizedManifest;
  options: PlanOptions;
}

export function buildPlan(input: ResolveInput): SyncPlan {
  const actions: PlanAction[] = [];
  const conflicts: PlanAction[] = [];
  let gets = 0;
  const { observed, options } = input;

  for (const obs of observed) {
    const desired = obs.desired;
    if (!obs.resolvedSource) {
      actions.push({ type: 'get', repository: desired });
      gets++;
      continue;
    }
    const linkTarget =
      obs.linkTarget ?? computeLinkTarget(obs.destinationPath, obs.resolvedSource.sourceRealPath);
    switch (obs.destinationKind) {
      case 'missing':
        actions.push({ type: 'link', repository: obs.resolvedSource, linkTarget });
        break;
      case 'symlink': {
        if (obs.resolvedLinkTarget === obs.resolvedSource.sourceRealPath) {
          if (obs.managedState) {
            actions.push({ type: 'noop', name: desired.name, reason: 'ready' });
          } else {
            actions.push({ type: 'adopt', repository: obs.resolvedSource, linkTarget });
          }
        } else if (obs.resolvedLinkTarget === undefined) {
          if (obs.managedState && options.repair) {
            actions.push({
              type: 'relink',
              repository: obs.resolvedSource,
              previousTarget: obs.rawLinkTarget ?? '',
              linkTarget,
            });
          } else {
            conflicts.push({
              type: 'conflict',
              name: desired.name,
              code: 'GHQV_DESTINATION_CONFLICT',
              message: `broken symlink at ${desired.name}`,
            });
          }
        } else {
          if (obs.managedState && options.repair) {
            actions.push({
              type: 'relink',
              repository: obs.resolvedSource,
              previousTarget: obs.rawLinkTarget ?? '',
              linkTarget,
            });
          } else {
            conflicts.push({
              type: 'conflict',
              name: desired.name,
              code: 'GHQV_DESTINATION_CONFLICT',
              message: `destination is occupied: ${desired.name}`,
            });
          }
        }
        break;
      }
      default:
        conflicts.push({
          type: 'conflict',
          name: desired.name,
          code: 'GHQV_DESTINATION_CONFLICT',
          message: `destination is occupied: ${desired.name}`,
        });
        break;
    }
  }

  // prune orphaned state-owned symlinks
  if (options.prune) {
    const known = new Set(observed.map((o) => o.desired.name));
    for (const [name, st] of Object.entries(input.state.repositories)) {
      if (known.has(name)) continue;
      const obs = observed.find((o) => o.desired.name === name);
      void obs;
      // prune only handled by executor which re-checks filesystem; emit unlink intent
      actions.push({
        type: 'unlink',
        name,
        relativePath: st.path,
        expectedTarget: st.linkTarget,
      });
    }
  }

  return { actions, conflicts, gets };
}

export function managedDirectoriesFor(manifest: NormalizedManifest): string[] {
  const dirs = new Set<string>();
  for (const r of manifest.repositories) {
    const segs = r.path.split('/');
    for (let i = 1; i < segs.length; i++) {
      dirs.add(segs.slice(0, i).join('/'));
    }
  }
  return [...dirs].sort();
}

export type { ManagedRepositoryState };
