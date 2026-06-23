import { describe, expect, it } from 'bun:test';
import {
  GITIGNORE_MARKERS,
  MD_MARKERS,
  replaceManagedBlock,
} from '../../src/rendering/managed-block';

describe('replaceManagedBlock', () => {
  it('creates file when absent', () => {
    const r = replaceManagedBlock(null, MD_MARKERS, 'hello');
    expect(r.changed).toBe(true);
    expect(r.content).toContain('<!-- ghqv:begin -->');
    expect(r.content).toContain('hello');
  });
  it('replaces only block content when markers present', () => {
    const existing = `header\n${MD_MARKERS.begin}\nold\n${MD_MARKERS.end}\nfooter\n`;
    const r = replaceManagedBlock(existing, MD_MARKERS, 'new');
    expect(r.changed).toBe(true);
    expect(r.content).toContain('header');
    expect(r.content).toContain('footer');
    expect(r.content).toContain('new');
    expect(r.content).not.toContain('old');
  });
  it('appends block when no markers', () => {
    const existing = 'user content\n';
    const r = replaceManagedBlock(existing, GITIGNORE_MARKERS, '/backend');
    expect(r.changed).toBe(true);
    expect(r.content).toContain('user content');
    expect(r.content).toContain('/backend');
  });
  it('throws on malformed markers', () => {
    const existing = `${MD_MARKERS.begin}\nold\n`;
    expect(() => replaceManagedBlock(existing, MD_MARKERS, 'new')).toThrow();
  });
  it('no change when content identical', () => {
    const block = `${MD_MARKERS.begin}\nsame\n${MD_MARKERS.end}\n`;
    const r = replaceManagedBlock(block, MD_MARKERS, 'same');
    expect(r.changed).toBe(false);
  });
});
