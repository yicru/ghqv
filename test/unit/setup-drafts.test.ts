import { describe, expect, it } from 'bun:test';
import { dependencyCandidateNames, orderDraftsForRegistration } from '../../src/cli/setup-drafts';
import { GhqvError } from '../../src/domain/errors';

describe('dependencyCandidateNames', () => {
  it('includes repositories configured after the current repository', () => {
    const candidates = dependencyCandidateNames('frontend', ['frontend', 'backend', 'worker']);

    expect(candidates).toEqual(['backend', 'worker']);
  });

  it('excludes the current repository from dependency candidates', () => {
    const candidates = dependencyCandidateNames('backend', ['frontend', 'backend']);

    expect(candidates).toEqual(['frontend']);
  });
});

describe('orderDraftsForRegistration', () => {
  it('registers dependencies before dependents even when selected later', () => {
    const ordered = orderDraftsForRegistration([
      { source: 'github.com/org/frontend', as: 'frontend', tech: [], dependsOn: ['backend'] },
      { source: 'github.com/org/backend', as: 'backend', tech: [], dependsOn: [] },
    ]);

    expect(ordered.map((draft) => draft.as)).toEqual(['backend', 'frontend']);
  });

  it('rejects dependency cycles before registration starts', () => {
    expect(() =>
      orderDraftsForRegistration([
        { source: 'github.com/org/frontend', as: 'frontend', tech: [], dependsOn: ['backend'] },
        { source: 'github.com/org/backend', as: 'backend', tech: [], dependsOn: ['frontend'] },
      ]),
    ).toThrow(GhqvError);
  });
});
