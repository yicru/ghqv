import { describe, expect, it } from 'bun:test';
import { emptyLocalState } from '../../src/domain/local-state';
import type { NormalizedManifest } from '../../src/domain/manifest';
import { buildPlan, computeLinkTarget } from '../../src/domain/plan';
import type { ObservedRepository, ResolvedRepository } from '../../src/domain/repository';

function mkResolved(name: string, sourceReal: string): ResolvedRepository {
  return {
    name,
    source: `github.com/o/${name}`,
    destinationRelativePath: name,
    mode: 'link',
    tech: [],
    dependsOn: [],
    sourcePath: `/ghq/github.com/o/${name}`,
    sourceRealPath: sourceReal,
  };
}

function mkObserved(
  opts: Partial<ObservedRepository> & { desired: ObservedRepository['desired'] },
): ObservedRepository {
  return {
    resolvedSource: undefined,
    destinationPath: `/ws/${opts.desired.name}`,
    destinationKind: 'missing',
    ...opts,
  };
}

const manifest = {
  version: 1,
  workspace: { name: 'ws', defaultMode: 'link' as const, autoGet: true },
  repositories: [],
} as unknown as NormalizedManifest;

describe('computeLinkTarget', () => {
  it('computes relative target', () => {
    expect(computeLinkTarget('/ws/backend', '/ghq/github.com/o/backend')).toBe(
      '../ghq/github.com/o/backend',
    );
  });
});

describe('buildPlan', () => {
  it('plans GET when source missing', () => {
    const observed = [
      mkObserved({
        desired: {
          name: 'a',
          source: 'github.com/o/a',
          destinationRelativePath: 'a',
          mode: 'link',
          tech: [],
          dependsOn: [],
        },
      }),
    ];
    const plan = buildPlan({
      observed,
      state: emptyLocalState('0', ''),
      manifest,
      options: { prune: false, repair: false },
    });
    expect(plan.gets).toBe(1);
    expect(plan.actions[0]?.type).toBe('get');
  });
  it('plans LINK when destination missing and source resolved', () => {
    const resolved = mkResolved('a', '/ghq/github.com/o/a');
    const observed = [
      mkObserved({
        desired: resolved,
        resolvedSource: resolved,
        destinationPath: '/ws/a',
        destinationKind: 'missing',
      }),
    ];
    const plan = buildPlan({
      observed,
      state: emptyLocalState('0', ''),
      manifest,
      options: { prune: false, repair: false },
    });
    expect(plan.actions[0]?.type).toBe('link');
  });
  it('NOOP when ready and state-owned', () => {
    const resolved = mkResolved('a', '/ghq/github.com/o/a');
    const observed = [
      mkObserved({
        desired: resolved,
        resolvedSource: resolved,
        destinationKind: 'symlink',
        resolvedLinkTarget: '/ghq/github.com/o/a',
        managedState: {
          source: resolved.source,
          path: 'a',
          mode: 'link',
          resolvedSourcePath: resolved.sourcePath,
          linkTarget: '../../ghq/github.com/o/a',
        },
      }),
    ];
    const plan = buildPlan({
      observed,
      state: emptyLocalState('0', ''),
      manifest,
      options: { prune: false, repair: false },
    });
    expect(plan.actions[0]?.type).toBe('noop');
  });
  it('ADOPT when correct link but not state-owned', () => {
    const resolved = mkResolved('a', '/ghq/github.com/o/a');
    const observed = [
      mkObserved({
        desired: resolved,
        resolvedSource: resolved,
        destinationKind: 'symlink',
        resolvedLinkTarget: '/ghq/github.com/o/a',
      }),
    ];
    const plan = buildPlan({
      observed,
      state: emptyLocalState('0', ''),
      manifest,
      options: { prune: false, repair: false },
    });
    expect(plan.actions[0]?.type).toBe('adopt');
  });
  it('CONFLICT when wrong link, state-owned, no repair', () => {
    const resolved = mkResolved('a', '/ghq/github.com/o/a');
    const observed = [
      mkObserved({
        desired: resolved,
        resolvedSource: resolved,
        destinationKind: 'symlink',
        resolvedLinkTarget: '/other',
        managedState: {
          source: resolved.source,
          path: 'a',
          mode: 'link',
          resolvedSourcePath: resolved.sourcePath,
          linkTarget: 'old',
        },
      }),
    ];
    const plan = buildPlan({
      observed,
      state: emptyLocalState('0', ''),
      manifest,
      options: { prune: false, repair: false },
    });
    expect(plan.conflicts.length).toBe(1);
  });
  it('RELINK when wrong link, state-owned, with repair', () => {
    const resolved = mkResolved('a', '/ghq/github.com/o/a');
    const observed = [
      mkObserved({
        desired: resolved,
        resolvedSource: resolved,
        destinationKind: 'symlink',
        resolvedLinkTarget: '/other',
        managedState: {
          source: resolved.source,
          path: 'a',
          mode: 'link',
          resolvedSourcePath: resolved.sourcePath,
          linkTarget: 'old',
        },
      }),
    ];
    const plan = buildPlan({
      observed,
      state: emptyLocalState('0', ''),
      manifest,
      options: { prune: false, repair: true },
    });
    expect(plan.actions[0]?.type).toBe('relink');
  });
  it('CONFLICT on regular file even with repair', () => {
    const resolved = mkResolved('a', '/ghq/github.com/o/a');
    const observed = [
      mkObserved({ desired: resolved, resolvedSource: resolved, destinationKind: 'file' }),
    ];
    const plan = buildPlan({
      observed,
      state: emptyLocalState('0', ''),
      manifest,
      options: { prune: false, repair: true },
    });
    expect(plan.conflicts.length).toBe(1);
  });
});

describe('computeLinkTarget nested workspace', () => {
  it('matches design example for nested workspace root', () => {
    expect(
      computeLinkTarget(
        '/Users/x/ghq/workspaces/myapp-vmono/backend',
        '/Users/x/ghq/github.com/organization-a/backend',
      ),
    ).toBe('../../github.com/organization-a/backend');
  });
});
