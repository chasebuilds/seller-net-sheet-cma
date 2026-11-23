import { describe, expect, it } from 'vitest';
import { normalizeState, sampleState } from '../src/state';

describe('save and load', () => {
  it('round trips through JSON', () => {
    const s = sampleState();
    const back = normalizeState(JSON.parse(JSON.stringify(s)));
    expect('state' in back && back.state.net.scenarios[1]?.price).toBe(385000);
    expect('state' in back && back.state.cma.comps).toHaveLength(14);
  });
  it('rejects wrong shapes with a plain message', () => {
    expect(normalizeState(null)).toHaveProperty('error');
    expect(normalizeState({ version: 2 })).toHaveProperty('error');
    const bad = sampleState();
    (bad.net.lines[0] as { mode: string }).mode = 'weird';
    expect(normalizeState(JSON.parse(JSON.stringify(bad)))).toHaveProperty('error');
    const two = sampleState();
    two.net.scenarios.pop();
    expect(normalizeState(JSON.parse(JSON.stringify(two)))).toHaveProperty('error');
  });
  it('sample marks every default cost line as a placeholder', () => {
    expect(sampleState().net.lines.every((l) => l.placeholder)).toBe(true);
  });
});
