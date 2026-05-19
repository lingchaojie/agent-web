import type { ParsedInteraction, PromptAction } from '../../shared/types';
import { stripTerminalControlSequences } from './terminalText';

export const MAX_ACTIONS = 10;
export const MAX_LABEL_LENGTH = 120;

export function parseInteraction(raw: string): ParsedInteraction {
  const normalized = stripTerminalControlSequences(raw);
  const choices = parseNumberedChoices(normalized);
  if (choices.length > 0) {
    return { kind: 'choice', raw, actions: choices };
  }

  if (looksLikePermission(normalized)) {
    return { kind: 'permission', raw, actions: [] };
  }

  return { kind: 'none', raw, actions: [] };
}

function looksLikePermission(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.includes('do you want to allow') ||
    lower.includes('permission') ||
    lower.includes('wants to run') ||
    lower.includes('allow this')
  );
}

function parseNumberedChoices(raw: string): PromptAction[] {
  const actions: PromptAction[] = [];
  for (const line of raw.split('\n')) {
    if (actions.length >= MAX_ACTIONS) break;

    const match = /^[\s│┃║╎╏┆┊┋├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫╭╮╰╯┌┐└┘─━═╼╾╴╶>›»•*-]*(\d+)\.\s+(.+?)\s*$/.exec(line);
    if (!match) continue;

    const label = match[2].trim().slice(0, MAX_LABEL_LENGTH);
    actions.push({
      id: `choice-${match[1]}`,
      label,
      input: match[1],
      variant: getChoiceVariant(label),
    });
  }
  return actions;
}

function getChoiceVariant(label: string): PromptAction['variant'] {
  if (/allow|yes|approve|proceed/i.test(label)) return 'allow';
  if (/deny|no|reject|cancel/i.test(label)) return 'deny';
  return 'neutral';
}

