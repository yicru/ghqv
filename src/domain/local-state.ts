import type { ManagedRepositoryState, MaterializationMode } from './repository';

export interface LocalStateV1 {
  version: 1;
  ghqvVersion: string;
  manifestDigest: string;
  updatedAt: string;
  repositories: Record<string, ManagedRepositoryState>;
  managedDirectories: string[];
}

export type LocalState = LocalStateV1;

export const LOCAL_STATE_VERSION = 1;

export function emptyLocalState(ghqvVersion: string, manifestDigest: string): LocalStateV1 {
  return {
    version: 1,
    ghqvVersion,
    manifestDigest,
    updatedAt: new Date().toISOString(),
    repositories: {},
    managedDirectories: [],
  };
}

export function isMaterializationMode(value: unknown): value is MaterializationMode {
  return value === 'link';
}
