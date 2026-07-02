import { EXIT_CODE, GhqvError } from '../domain/errors';

export interface RepoMetadataDraft {
  readonly source: string;
  readonly as: string;
  readonly role?: string;
  readonly tech: string[];
}

export interface RepoDraft extends RepoMetadataDraft {
  readonly dependsOn: string[];
}

export function dependencyCandidateNames(
  currentName: string,
  allNames: readonly string[],
): string[] {
  return allNames.filter((name) => name !== currentName);
}

export function orderDraftsForRegistration(drafts: readonly RepoDraft[]): RepoDraft[] {
  const byName = new Map(drafts.map((draft) => [draft.as, draft]));
  const ordered: RepoDraft[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(name: string, path: readonly string[]): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      const cycleStart = path.indexOf(name);
      const cycle = [...path.slice(cycleStart), name].join(' -> ');
      throw new GhqvError(
        'GHQV_MANIFEST_INVALID',
        `depends_on cycle detected: ${cycle}`,
        EXIT_CODE.USAGE,
      );
    }
    const draft = byName.get(name);
    if (!draft) {
      throw new GhqvError(
        'GHQV_MANIFEST_INVALID',
        `depends_on unknown repository: ${name}`,
        EXIT_CODE.USAGE,
      );
    }

    visiting.add(name);
    for (const dep of draft.dependsOn) {
      visit(dep, [...path, name]);
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(draft);
  }

  for (const draft of drafts) {
    visit(draft.as, []);
  }
  return ordered;
}
