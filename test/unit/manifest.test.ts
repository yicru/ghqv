import { describe, expect, it } from 'bun:test';
import { GhqvError } from '../../src/domain/errors';
import { type ManifestV1, normalizeManifest, normalizeSource } from '../../src/domain/manifest';

describe('normalizeSource', () => {
  it('accepts canonical host/namespace/repo', () => {
    expect(normalizeSource('github.com/org-a/backend')).toBe('github.com/org-a/backend');
  });
  it('strips trailing .git and slashes', () => {
    expect(normalizeSource('github.com/org-a/backend.git/')).toBe('github.com/org-a/backend');
  });
  it('reduces scp-style to canonical', () => {
    expect(normalizeSource('git@github.com:org-a/backend.git')).toBe('github.com/org-a/backend');
  });
  it('reduces https url to canonical', () => {
    expect(normalizeSource('https://github.com/org-a/backend.git')).toBe(
      'github.com/org-a/backend',
    );
  });
  it('rejects too few segments', () => {
    expect(() => normalizeSource('github.com/org-a')).toThrow(GhqvError);
  });
  it('rejects empty', () => {
    expect(() => normalizeSource('   ')).toThrow(GhqvError);
  });
});

describe('normalizeManifest', () => {
  function mk(repos: Record<string, any>): ManifestV1 {
    return {
      version: 1,
      workspace: { name: 'ws', default_mode: 'link', auto_get: true },
      repositories: repos,
    };
  }
  it('applies defaults', () => {
    const n = normalizeManifest(mk({ backend: { source: 'github.com/org/backend' } }));
    expect(n.repositories[0]?.path).toBe('backend');
    expect(n.repositories[0]?.mode).toBe('link');
    expect(n.repositories[0]?.tech).toEqual([]);
    expect(n.workspace.autoGet).toBe(true);
  });
  it('rejects unsupported version', () => {
    expect(() =>
      normalizeManifest({ version: 2 as any, workspace: { name: 'x' }, repositories: {} }),
    ).toThrow(GhqvError);
  });
  it('rejects duplicate source', () => {
    expect(() =>
      normalizeManifest(mk({ a: { source: 'github.com/o/r' }, b: { source: 'github.com/o/r' } })),
    ).toThrow(GhqvError);
  });
  it('rejects path traversal', () => {
    expect(() =>
      normalizeManifest(mk({ a: { source: 'github.com/o/r', path: '../escape' } })),
    ).toThrow(GhqvError);
  });
  it('rejects reserved path', () => {
    expect(() => normalizeManifest(mk({ a: { source: 'github.com/o/r', path: '.git' } }))).toThrow(
      GhqvError,
    );
  });
  it('rejects ancestor path collision', () => {
    expect(() =>
      normalizeManifest(
        mk({
          a: { source: 'github.com/o/r', path: 'svc' },
          b: { source: 'github.com/o/r2', path: 'svc/b' },
        }),
      ),
    ).toThrow(GhqvError);
  });
  it('allows shared intermediate dir', () => {
    const n = normalizeManifest(
      mk({
        a: { source: 'github.com/o/r', path: 'svc/a' },
        b: { source: 'github.com/o/r2', path: 'svc/b' },
      }),
    );
    expect(n.repositories).toHaveLength(2);
  });
  it('rejects unknown depends_on', () => {
    expect(() =>
      normalizeManifest(mk({ a: { source: 'github.com/o/r', depends_on: ['nope'] } })),
    ).toThrow(GhqvError);
  });
  it('rejects self depends_on', () => {
    expect(() =>
      normalizeManifest(mk({ a: { source: 'github.com/o/r', depends_on: ['a'] } })),
    ).toThrow(GhqvError);
  });
  it('rejects case-insensitive path collision', () => {
    expect(() =>
      normalizeManifest(
        mk({
          a: { source: 'github.com/o/r', path: 'Foo' },
          b: { source: 'github.com/o/r2', path: 'foo' },
        }),
      ),
    ).toThrow(GhqvError);
  });
});
