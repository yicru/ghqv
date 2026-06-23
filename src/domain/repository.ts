export type MaterializationMode = 'link';

export interface DesiredRepository {
  name: string;
  source: string;
  destinationRelativePath: string;
  mode: MaterializationMode;
  role?: string;
  tech: string[];
  dependsOn: string[];
}

export interface ResolvedRepository extends DesiredRepository {
  sourcePath: string;
  sourceRealPath: string;
}

export type DestinationKind = 'missing' | 'symlink' | 'file' | 'directory' | 'other';

export interface ManagedRepositoryState {
  source: string;
  path: string;
  mode: MaterializationMode;
  resolvedSourcePath: string;
  linkTarget: string;
}

export interface ObservedRepository {
  desired: DesiredRepository;
  resolvedSource?: ResolvedRepository;
  destinationPath: string;
  destinationKind: DestinationKind;
  rawLinkTarget?: string;
  resolvedLinkTarget?: string;
  managedState?: ManagedRepositoryState;
  linkTarget?: string;
}
