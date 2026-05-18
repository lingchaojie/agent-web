import { describe, expect, it } from 'vitest';
import { parseInteraction } from '../../src/server/services/interactionParser';

describe('parseInteraction', () => {
  it('does not invent permission actions without parsed choices', () => {
    const parsed = parseInteraction('Claude wants to run Bash command: npm test\nDo you want to allow this?');

    expect(parsed.kind).toBe('permission');
    expect(parsed.actions).toEqual([]);
  });

  it('detects numbered choice prompts', () => {
    const parsed = parseInteraction('Choose an option:\n1. Yes\n2. No\n3. Always allow');

    expect(parsed.kind).toBe('choice');
    expect(parsed.actions).toEqual([
      { id: 'choice-1', label: 'Yes', input: '1', variant: 'allow' },
      { id: 'choice-2', label: 'No', input: '2', variant: 'deny' },
      { id: 'choice-3', label: 'Always allow', input: '3', variant: 'allow' },
    ]);
  });

  it('preserves numbered labels and assigns variants before permission fallback', () => {
    const parsed = parseInteraction('Claude wants to run Bash command\n1. Allow once\n2. Always allow\n3. Deny');

    expect(parsed.kind).toBe('choice');
    expect(parsed.actions).toEqual([
      { id: 'choice-1', label: 'Allow once', input: '1', variant: 'allow' },
      { id: 'choice-2', label: 'Always allow', input: '2', variant: 'allow' },
      { id: 'choice-3', label: 'Deny', input: '3', variant: 'deny' },
    ]);
  });

  it('parses decorated permission choices without falling back to hard-coded deny', () => {
    const parsed = parseInteraction([
      '[2m╭─ Claude wants to run Bash command[0m',
      '│  [32m1. Allow once[0m',
      '│  [32m2. Always allow[0m',
      '│  [31m3. Deny[0m',
    ].join('\n'));

    expect(parsed.kind).toBe('choice');
    expect(parsed.actions).toEqual([
      { id: 'choice-1', label: 'Allow once', input: '1', variant: 'allow' },
      { id: 'choice-2', label: 'Always allow', input: '2', variant: 'allow' },
      { id: 'choice-3', label: 'Deny', input: '3', variant: 'deny' },
    ]);
  });

  it('limits numbered choices to 10 actions', () => {
    const raw = Array.from({ length: 12 }, (_, index) => `${index + 1}. Option ${index + 1}`).join('\n');

    const parsed = parseInteraction(raw);

    expect(parsed.kind).toBe('choice');
    expect(parsed.actions).toHaveLength(10);
    expect(parsed.actions.at(-1)).toEqual({
      id: 'choice-10',
      label: 'Option 10',
      input: '10',
      variant: 'neutral',
    });
  });

  it('truncates choice labels longer than 120 characters', () => {
    const longLabel = 'a'.repeat(121);

    const parsed = parseInteraction(`1. ${longLabel}`);

    expect(parsed.kind).toBe('choice');
    expect(parsed.actions[0]?.label).toHaveLength(120);
  });

  it('falls back to none for normal output', () => {
    const parsed = parseInteraction('I updated the file and tests pass.');

    expect(parsed.kind).toBe('none');
    expect(parsed.actions).toEqual([]);
  });
});
