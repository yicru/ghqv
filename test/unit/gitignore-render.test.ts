import { describe, expect, it } from 'bun:test';
import type { NormalizedManifest } from '../../src/domain/manifest';
import { renderGitignore } from '../../src/rendering/gitignore';

describe('renderGitignore', () => {
  it('lists paths in manifest order', () => {
    const manifest = {
      version: 1,
      workspace: { name: 'ws', defaultMode: 'link' as const, autoGet: true },
      repositories: [
        {
          name: 'a',
          source: 'github.com/o/a',
          path: 'backend',
          mode: 'link' as const,
          tech: [],
          dependsOn: [],
        },
        {
          name: 'b',
          source: 'github.com/o/b',
          path: 'services/billing',
          mode: 'link' as const,
          tech: [],
          dependsOn: [],
        },
      ],
    } as unknown as NormalizedManifest;
    const r = renderGitignore(manifest, null);
    expect(r.content).toContain('/backend');
    expect(r.content).toContain('/services/billing');
    expect(r.changed).toBe(true);
  });
});
