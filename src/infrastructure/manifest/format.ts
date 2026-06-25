import { YAMLMap, YAMLSeq } from 'yaml';

/**
 * Force every mapping in a YAML document to block style and every sequence to
 * inline (`[ a, b ]`) style. This keeps generated manifests free of the flow
 * `{ ... }` object syntax while keeping short lists compact on one line.
 */
export function forceBlockMappings(node: unknown): void {
  if (node instanceof YAMLMap) {
    node.flow = false;
    for (const pair of node.items) {
      forceBlockMappings(pair.key);
      forceBlockMappings(pair.value);
    }
  } else if (node instanceof YAMLSeq) {
    node.flow = false;
    for (const item of node.items) forceBlockMappings(item);
  }
}

interface StringifiableDoc {
  contents: unknown;
  toString(): string;
}

/** Stringify a yaml Document with block-style mappings and inline sequences. */
export function stringifyManifest(doc: StringifiableDoc): string {
  forceBlockMappings(doc.contents);
  return doc.toString();
}
