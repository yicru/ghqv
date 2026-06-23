import { describe, expect, it } from 'bun:test';
import { redactArgs } from '../../src/infrastructure/process/bun-process-runner';

describe('redactArgs', () => {
  it('redacts userinfo and query', () => {
    const out = redactArgs(['https://user:pass@github.com/o/r?token=secret', 'github.com/o/r']);
    expect(out[0]).not.toContain('user');
    expect(out[0]).not.toContain('pass');
    expect(out[0]).not.toContain('token');
    expect(out[1]).toBe('github.com/o/r');
  });
  it('leaves plain args untouched', () => {
    expect(redactArgs(['--full-path', '--exact', 'github.com/o/r'])).toEqual([
      '--full-path',
      '--exact',
      'github.com/o/r',
    ]);
  });
});
