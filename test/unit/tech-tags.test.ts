import { describe, expect, it } from 'bun:test';
import { formatTechTagsInput, parseTechTagsInput } from '../../src/cli/tech-tags';

describe('parseTechTagsInput', () => {
  it('preserves multi-word technology tags when comma-separated', () => {
    // Given
    const input = 'PHP 5.6, FuelPHP 1.6, React Router 7, TanStack Query';

    // When
    const tags = parseTechTagsInput(input);

    // Then
    expect(tags).toEqual(['PHP 5.6', 'FuelPHP 1.6', 'React Router 7', 'TanStack Query']);
  });

  it('deduplicates tags after whitespace normalization', () => {
    // Given
    const input = ' PHP   5.6 , PHP 5.6,  MySQL ';

    // When
    const tags = parseTechTagsInput(input);

    // Then
    expect(tags).toEqual(['PHP 5.6', 'MySQL']);
  });
});

describe('formatTechTagsInput', () => {
  it('keeps AI-suggested multi-word tags editable without losing boundaries', () => {
    // Given
    const tags = ['PHP 5.6', 'FuelPHP 1.6', 'React Router 7'];

    // When
    const input = formatTechTagsInput(tags);

    // Then
    expect(input).toBe('PHP 5.6, FuelPHP 1.6, React Router 7');
  });
});
