import type { LocalState } from '../domain/local-state';
import type { ManifestV1 } from '../domain/manifest';
import type { MaterializationMode } from '../domain/repository';

export interface ProcessRequest {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: 'ignore' | 'inherit';
  output?: 'capture' | 'inherit';
  signal?: AbortSignal;
  maxOutputBytes?: number;
  allowFailure?: boolean;
}

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ProcessRunner {
  run(request: ProcessRequest): Promise<ProcessResult>;
}

export interface GhqClient {
  version(): Promise<string>;
  roots(): Promise<string[]>;
  resolveExact(source: string): Promise<string[]>;
  list(): Promise<string[]>;
  get(source: string, options: { interactive: boolean }): Promise<void>;
}

export interface GitClient {
  init(path: string): Promise<void>;
  clone(url: string, destination: string, options?: { signal?: AbortSignal }): Promise<void>;
  topLevel(path: string): Promise<string>;
  isBare(path: string): Promise<boolean>;
  gitPath(workspace: string, relativePath: string): Promise<string>;
  branch(path: string): Promise<string | null>;
  shortHead(path: string): Promise<string | null>;
  isDirty(path: string): Promise<boolean>;
}

export interface FileEntry {
  kind: 'symlink' | 'file' | 'directory' | 'other';
  symlinkTarget?: string;
  exists: boolean;
}

export interface FileSystem {
  lstat(path: string): Promise<FileEntry | null>;
  realpath(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  mkdirAll(path: string): Promise<void>;
  symlink(target: string, path: string): Promise<void>;
  readlink(path: string): Promise<string>;
  unlink(path: string): Promise<void>;
  rmdir(path: string): Promise<void>;
  readText(path: string): Promise<string>;
  writeTextAtomic(path: string, content: string, mode?: number): Promise<void>;
  exists(path: string): Promise<boolean>;
  readdir(path: string): Promise<string[]>;
}

export interface ManifestStore {
  read(workspace: string): Promise<{ content: string; manifest: ManifestV1 }>;
  write(workspace: string, content: string): Promise<void>;
  exists(workspace: string): Promise<boolean>;
}

export interface StateStore {
  path(workspace: string): Promise<string>;
  read(workspace: string): Promise<LocalState | null>;
  write(workspace: string, state: LocalState): Promise<void>;
  exists(workspace: string): Promise<boolean>;
}

export interface LockHandle {
  release(): Promise<void>;
}

export interface LockManager {
  acquire(workspace: string, info: LockInfo): Promise<LockHandle>;
  current(workspace: string): Promise<LockInfo | null>;
  removeStale(workspace: string): Promise<boolean>;
}

export interface LockInfo {
  version: 1;
  pid: number;
  hostname: string;
  command: string;
  startedAt: string;
  ghqvVersion: string;
}

export interface ConfigStore {
  getWorkspaceRoot(): Promise<string | null>;
  setWorkspaceRoot(path: string): Promise<void>;
  unsetWorkspaceRoot(): Promise<void>;
}

export interface WorkspaceRootResolver {
  resolve(): Promise<string>;
}

export type { MaterializationMode };
