import { createHash } from 'node:crypto';
import { EXIT_CODE, GhqvError } from './errors';
import type { MaterializationMode } from './repository';

export type ManifestVersion = 1;

export interface ManifestV1 {
  version: ManifestVersion;
  workspace: {
    name: string;
    description?: string;
    default_mode?: MaterializationMode;
    auto_get?: boolean;
  };
  repositories: Record<string, RepositorySpecV1>;
}

export interface RepositorySpecV1 {
  source: string;
  path?: string;
  role?: string;
  tech?: string[];
  depends_on?: string[];
  mode?: MaterializationMode;
}

export type Manifest = ManifestV1;
export type RepositorySpec = RepositorySpecV1;

export const MANIFEST_VERSION = 1;
export const MANIFEST_FILENAME = '.ghqv.yaml';
export const MANIFEST_MAX_BYTES = 1024 * 1024; // 1 MiB

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const NAME_RE = SEGMENT_RE;
const RESERVED_PATHS = new Set([
  '.git',
  '.ghqv.yaml',
  '.gitignore',
  'AGENTS.md',
  'CLAUDE.md',
  'architecture',
]);

export interface NormalizedRepository {
  name: string;
  source: string;
  path: string;
  mode: MaterializationMode;
  role?: string;
  tech: string[];
  dependsOn: string[];
}

export interface NormalizedManifest {
  version: ManifestVersion;
  workspace: {
    name: string;
    description?: string;
    defaultMode: MaterializationMode;
    autoGet: boolean;
  };
  repositories: NormalizedRepository[];
}

function fail(code: GhqvError['code'], message: string, hint?: string): never {
  throw new GhqvError(code, message, EXIT_CODE.USAGE, { hint });
}

export function validateName(name: string, field: string): void {
  if (!NAME_RE.test(name)) {
    fail(
      'GHQV_MANIFEST_INVALID',
      `invalid ${field}: ${JSON.stringify(name)}`,
      `Must match ${NAME_RE.source}.`,
    );
  }
}

export function normalizeSource(source: string): string {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    fail('GHQV_MANIFEST_INVALID', 'source must not be empty');
  }
  let canonical = trimmed;
  try {
    const url = new URL(canonical);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ssh:') {
      canonical = `${url.host}${url.pathname}`;
    } else if (url.protocol === 'file:') {
      fail('GHQV_MANIFEST_INVALID', `file: source is not supported: ${source}`);
    }
  } catch {
    const scpMatch = canonical.match(/^[\w.-]+@([^/]+):(.+)$/);
    if (scpMatch) {
      canonical = `${scpMatch[1]}/${scpMatch[2]}`;
    }
  }
  canonical = canonical.replace(/\/+$/, '').replace(/\.git$/, '');
  const segments = canonical.split('/');
  if (segments.length < 3) {
    fail('GHQV_MANIFEST_INVALID', `source must be host/namespace/repository: ${source}`);
  }
  for (const seg of segments) {
    if (!SEGMENT_RE.test(seg)) {
      fail('GHQV_MANIFEST_INVALID', `invalid source segment: ${JSON.stringify(seg)}`);
    }
  }
  if (canonical.length > 512) {
    fail('GHQV_MANIFEST_INVALID', `source too long: ${source}`);
  }
  return canonical;
}

function validatePath(pathValue: string, name: string): void {
  if (pathValue === '') {
    fail('GHQV_MANIFEST_INVALID', `path must not be empty for repository ${name}`);
  }
  if (pathValue.startsWith('/')) {
    fail('GHQV_MANIFEST_INVALID', `path must be relative for repository ${name}: ${pathValue}`);
  }
  if (pathValue.includes('\\')) {
    fail('GHQV_MANIFEST_INVALID', `path must not contain backslash for repository ${name}`);
  }
  const segments = pathValue.split('/');
  if (segments.length > 16) {
    fail('GHQV_MANIFEST_INVALID', `path too deep for repository ${name}: ${pathValue}`);
  }
  if (pathValue.length > 512) {
    fail('GHQV_MANIFEST_INVALID', `path too long for repository ${name}`);
  }
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      fail(
        'GHQV_MANIFEST_INVALID',
        `path must not contain ".", ".." or empty segments for repository ${name}: ${pathValue}`,
      );
    }
    if (!SEGMENT_RE.test(seg)) {
      fail(
        'GHQV_MANIFEST_INVALID',
        `invalid path segment for repository ${name}: ${JSON.stringify(seg)}`,
      );
    }
  }
  if (RESERVED_PATHS.has(pathValue) || segments.some((s) => RESERVED_PATHS.has(s))) {
    fail(
      'GHQV_MANIFEST_INVALID',
      `path conflicts with a reserved workspace path for repository ${name}: ${pathValue}`,
    );
  }
}

function isMode(value: unknown): value is MaterializationMode {
  return value === 'link';
}

function validateStringList(value: unknown, field: string, max: number, itemMax: number): string[] {
  if (!Array.isArray(value)) {
    fail('GHQV_MANIFEST_INVALID', `${field} must be an array`);
  }
  if (value.length > max) {
    fail('GHQV_MANIFEST_INVALID', `${field} must have at most ${max} entries`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      fail('GHQV_MANIFEST_INVALID', `${field} entries must be strings`);
    }
    if (item.includes('\n') || item.length > itemMax) {
      fail(
        'GHQV_MANIFEST_INVALID',
        `${field} entry too long or multiline: ${JSON.stringify(item)}`,
      );
    }
    out.push(item);
  }
  return out;
}

export function normalizeManifest(manifest: ManifestV1): NormalizedManifest {
  if (manifest.version !== MANIFEST_VERSION) {
    fail(
      'GHQV_UNSUPPORTED_MANIFEST_VERSION',
      `unsupported manifest version: ${manifest.version}`,
      'Upgrade ghqv to a version that supports this manifest.',
    );
  }
  const wsName = manifest.workspace?.name;
  if (typeof wsName !== 'string' || wsName.length === 0) {
    fail('GHQV_MANIFEST_INVALID', 'workspace.name is required');
  }
  validateName(wsName, 'workspace.name');
  const defaultMode = manifest.workspace.default_mode ?? 'link';
  if (!isMode(defaultMode)) {
    fail('GHQV_MANIFEST_INVALID', `unsupported default_mode: ${defaultMode}`);
  }
  const autoGet = manifest.workspace.auto_get ?? true;
  const description = manifest.workspace.description;
  if (description !== undefined && (typeof description !== 'string' || description.length > 1000)) {
    fail(
      'GHQV_MANIFEST_INVALID',
      'workspace.description must be a string of at most 1000 characters',
    );
  }

  const repos = manifest.repositories ?? {};
  const names = Object.keys(repos);
  const seenSources = new Set<string>();
  const normalized: NormalizedRepository[] = [];
  for (const name of names) {
    validateName(name, 'repository name');
    const spec = repos[name];
    if (!spec || typeof spec !== 'object') {
      fail('GHQV_MANIFEST_INVALID', `repository ${name} must be a mapping`);
    }
    if (typeof spec.source !== 'string') {
      fail('GHQV_MANIFEST_INVALID', `repository ${name} source is required`);
    }
    const source = normalizeSource(spec.source);
    if (seenSources.has(source)) {
      fail('GHQV_MANIFEST_INVALID', `duplicate source: ${source}`);
    }
    seenSources.add(source);
    const pathValue = spec.path ?? name;
    validatePath(pathValue, name);
    const mode = spec.mode ?? defaultMode;
    if (!isMode(mode)) {
      fail('GHQV_MANIFEST_INVALID', `repository ${name} has unsupported mode: ${mode}`);
    }
    const role = spec.role;
    if (role !== undefined) {
      if (typeof role !== 'string' || role.includes('\n') || role.length > 200) {
        fail(
          'GHQV_MANIFEST_INVALID',
          `repository ${name} role must be a single line of at most 200 characters`,
        );
      }
    }
    const tech = spec.tech ? validateStringList(spec.tech, `repository ${name} tech`, 20, 100) : [];
    if (new Set(tech).size !== tech.length) {
      fail('GHQV_MANIFEST_INVALID', `repository ${name} tech has duplicates`);
    }
    const dependsOn = spec.depends_on
      ? validateStringList(spec.depends_on, `repository ${name} depends_on`, 1000, 128)
      : [];
    normalized.push({ name, source, path: pathValue, mode, role, tech, dependsOn });
  }

  // path collisions
  const pathMap = new Map<string, string>();
  const lowerMap = new Map<string, string>();
  for (const r of normalized) {
    if (pathMap.has(r.path)) {
      fail('GHQV_MANIFEST_INVALID', `duplicate path: ${r.path}`);
    }
    pathMap.set(r.path, r.name);
    const lower = r.path.toLowerCase();
    if (lowerMap.has(lower)) {
      fail('GHQV_MANIFEST_INVALID', `path collides case-insensitively: ${r.path}`);
    }
    lowerMap.set(lower, r.name);
  }
  // ancestor collisions
  for (const a of normalized) {
    for (const b of normalized) {
      if (a.name === b.name) continue;
      const aSegs = a.path.split('/');
      const bSegs = b.path.split('/');
      if (aSegs.length < bSegs.length && bSegs.slice(0, aSegs.length).join('/') === a.path) {
        fail('GHQV_MANIFEST_INVALID', `path "${a.path}" is an ancestor of "${b.path}"`);
      }
    }
  }
  // depends_on validation
  const nameSet = new Set(normalized.map((r) => r.name));
  for (const r of normalized) {
    const seen = new Set<string>();
    for (const dep of r.dependsOn) {
      if (dep === r.name) {
        fail('GHQV_MANIFEST_INVALID', `repository ${r.name} depends_on itself`);
      }
      if (!nameSet.has(dep)) {
        fail('GHQV_MANIFEST_INVALID', `repository ${r.name} depends_on unknown repository: ${dep}`);
      }
      if (seen.has(dep)) {
        fail('GHQV_MANIFEST_INVALID', `repository ${r.name} depends_on has duplicate: ${dep}`);
      }
      seen.add(dep);
    }
  }

  return {
    version: MANIFEST_VERSION,
    workspace: { name: wsName, description, defaultMode, autoGet },
    repositories: normalized,
  };
}

export function emptyManifest(name: string): ManifestV1 {
  return {
    version: 1,
    workspace: { name, default_mode: 'link', auto_get: true },
    repositories: {},
  };
}

export function manifestDigest(content: string): string {
  // sha256 of UTF-8 bytes
  return `sha256:${hashSha256(content)}`;
}

function hashSha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
