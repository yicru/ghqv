import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Document, parse, parseAllDocuments } from 'yaml';
import type { ManifestStore } from '../../application/ports';
import { EXIT_CODE, GhqvError } from '../../domain/errors';
import { MANIFEST_FILENAME, MANIFEST_MAX_BYTES, type ManifestV1 } from '../../domain/manifest';
import { manifestSchema } from './schema';

function rejectUnsafeYaml(content: string): void {
  const docs = parseAllDocuments(content);
  if (docs.length > 1) {
    throw new GhqvError(
      'GHQV_MANIFEST_PARSE_ERROR',
      'manifest must be a single YAML document',
      EXIT_CODE.USAGE,
    );
  }
  const doc = docs[0];
  if (!doc) return;
  for (const node of (doc.contents ? [doc.contents] : []) as any[]) {
    walkYaml(node as any, (n) => {
      if (n.tag && n.tag !== '?' && !n.tag.startsWith('tag:yaml.org,2002:')) {
        throw new GhqvError(
          'GHQV_MANIFEST_PARSE_ERROR',
          `custom YAML tag is not allowed: ${n.tag}`,
          EXIT_CODE.USAGE,
        );
      }
      if (n.anchor) {
        throw new GhqvError(
          'GHQV_MANIFEST_PARSE_ERROR',
          `YAML anchor is not allowed: ${n.anchor}`,
          EXIT_CODE.USAGE,
        );
      }
    });
  }
}

function walkYaml(node: any, visit: (n: any) => void): void {
  if (!node || typeof node !== 'object') return;
  visit(node);
  if (node.items && Array.isArray(node.items)) {
    for (const it of node.items) walkYaml(it, visit);
  }
  if (node.entries && Array.isArray(node.entries)) {
    for (const e of node.entries) {
      if (e && typeof e === 'object') {
        if (e.key) walkYaml(e.key, visit);
        if (e.value) walkYaml(e.value, visit);
      }
    }
  }
}

function checkDuplicateKeys(content: string): void {
  // Detect duplicate keys at any mapping level via low-level parse.
  const docs = parseAllDocuments(content);
  const doc = docs[0];
  if (!doc) return;
  const root = doc.contents;
  if (!root) return;
  checkDupNode(root);
}

function checkDupNode(node: any): void {
  if (!node || typeof node !== 'object') return;
  if (node.entries && Array.isArray(node.entries)) {
    const seen = new Set<string>();
    for (const e of node.entries) {
      const k = e?.key ? String(e.key.value ?? e.key) : '';
      if (seen.has(k)) {
        throw new GhqvError(
          'GHQV_MANIFEST_PARSE_ERROR',
          `duplicate key in manifest: ${k}`,
          EXIT_CODE.USAGE,
        );
      }
      seen.add(k);
      if (e.key) checkDupNode(e.key);
      if (e.value) checkDupNode(e.value);
    }
  }
  if (node.items && Array.isArray(node.items)) {
    for (const it of node.items) checkDupNode(it);
  }
}

export class YamlManifestStore implements ManifestStore {
  async read(workspace: string): Promise<{ content: string; manifest: ManifestV1 }> {
    const file = join(workspace, MANIFEST_FILENAME);
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      throw new GhqvError(
        'GHQV_MANIFEST_NOT_FOUND',
        `manifest not found: ${file}`,
        EXIT_CODE.NOT_FOUND,
      );
    }
    if (Buffer.byteLength(content, 'utf8') > MANIFEST_MAX_BYTES) {
      throw new GhqvError(
        'GHQV_MANIFEST_PARSE_ERROR',
        `manifest exceeds max size of ${MANIFEST_MAX_BYTES} bytes`,
        EXIT_CODE.USAGE,
      );
    }
    rejectUnsafeYaml(content);
    checkDuplicateKeys(content);
    let parsed: unknown;
    try {
      parsed = parse(content, { schema: 'core' });
    } catch (e) {
      throw new GhqvError(
        'GHQV_MANIFEST_PARSE_ERROR',
        `manifest parse error: ${(e as Error).message}`,
        EXIT_CODE.USAGE,
        { cause: e },
      );
    }
    const result = manifestSchema.safeParse(parsed);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new GhqvError(
        'GHQV_MANIFEST_INVALID',
        `manifest invalid: ${first ? `${first.path.join('.')}: ${first.message}` : 'unknown'}`,
        EXIT_CODE.USAGE,
        { details: { issues: result.error.issues } },
      );
    }
    // disallow unknown top-level keys
    const allowed = new Set(['version', 'workspace', 'repositories']);
    for (const k of Object.keys(parsed as object)) {
      if (!allowed.has(k)) {
        throw new GhqvError(
          'GHQV_MANIFEST_INVALID',
          `unknown manifest field: ${k}`,
          EXIT_CODE.USAGE,
        );
      }
    }
    return { content, manifest: result.data as ManifestV1 };
  }

  async write(workspace: string, content: string): Promise<void> {
    const file = join(workspace, MANIFEST_FILENAME);
    const { writeTextAtomic } = await import('../filesystem/atomic-write');
    await writeTextAtomic(file, content, 0o644);
  }

  async exists(workspace: string): Promise<boolean> {
    try {
      await readFile(join(workspace, MANIFEST_FILENAME), 'utf8');
      return true;
    } catch {
      return false;
    }
  }
}

export { Document };
