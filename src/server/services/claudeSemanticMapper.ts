import type { ConversationBlockKind, ConversationBlockSource, ConversationBlockStatus, ParsedInteraction, SessionActivity } from '../../shared/types';
import type { ClaudeSemanticEvent } from './claudeEventSource';

export type SemanticBlockPart = {
  kind: ConversationBlockKind;
  text: string;
  status: ConversationBlockStatus;
  source: ConversationBlockSource;
  interaction?: ParsedInteraction;
  sourceEventId?: string;
  createdAt?: string;
};

export type SemanticActivityPart = {
  activity: SessionActivity;
  activityLabel?: string;
};

export type SemanticMappingResult = {
  block?: SemanticBlockPart;
  activity?: SemanticActivityPart;
  finalizeMessageId?: string;
  lifecycle?: 'running' | 'idle' | 'waiting-for-input' | 'stopping' | 'stopped' | 'failed' | 'degraded-fallback';
  ignored?: boolean;
};

export type ClaudeJsonlEntry = {
  type?: string;
  uuid?: string;
  timestamp?: string;
  content?: unknown;
  message?: {
    role?: string;
    content?: unknown;
  };
};

export function mapClaudeEventToSemantic(event: ClaudeSemanticEvent): SemanticMappingResult {
  if (event.type === 'user-message') {
    return { block: { kind: 'user', text: event.text, status: 'final', source: 'structured', sourceEventId: event.messageId, createdAt: event.createdAt } };
  }

  if (event.type === 'assistant-message-started') {
    return event.text ? { block: { kind: 'assistant', text: event.text, status: 'streaming', source: 'structured', sourceEventId: event.messageId, createdAt: event.createdAt } } : { activity: { activity: 'working' } };
  }

  if (event.type === 'assistant-message-delta') {
    return { block: { kind: 'assistant', text: event.text ?? '', status: 'streaming', source: 'structured', sourceEventId: event.messageId, createdAt: event.createdAt } };
  }

  if (event.type === 'assistant-message-completed') {
    return { block: { kind: 'assistant', text: event.text ?? '', status: 'final', source: 'structured', sourceEventId: event.messageId, createdAt: event.createdAt }, activity: { activity: 'idle' }, finalizeMessageId: event.messageId };
  }

  if (event.type === 'tool-use-started' || event.type === 'tool-use-updated') {
    return { block: { kind: 'tool', text: event.text ?? toolText(event.name, event.input), status: 'streaming', source: 'structured', sourceEventId: event.toolUseId, createdAt: event.createdAt }, activity: { activity: 'working' } };
  }

  if (event.type === 'tool-use-completed') {
    return { block: { kind: 'tool', text: event.text ?? toolText(event.name, event.input), status: 'final', source: 'structured', sourceEventId: event.toolUseId, createdAt: event.createdAt }, activity: { activity: 'idle' }, finalizeMessageId: event.toolUseId };
  }

  if (event.type === 'permission-requested' || event.type === 'choice-requested') {
    return { block: { kind: 'interaction', text: event.text, status: 'final', source: 'structured', sourceEventId: event.promptId, interaction: event.interaction, createdAt: event.createdAt }, activity: { activity: 'idle' }, lifecycle: 'waiting-for-input' };
  }

  if (event.type === 'usage-or-activity-updated') {
    return { activity: { activity: event.activity, activityLabel: event.activityLabel } };
  }

  if (event.type === 'session-started') {
    return { lifecycle: event.lifecycle ?? 'running', activity: { activity: 'idle' } };
  }

  if (event.type === 'session-stopped') {
    return { lifecycle: 'idle', activity: { activity: 'idle' } };
  }

  if (event.type === 'session-failed') {
    return { lifecycle: 'failed', activity: { activity: 'stopped' } };
  }

  if (event.type === 'structured-source-unavailable') {
    return { lifecycle: 'degraded-fallback', activity: { activity: 'idle', activityLabel: event.message } };
  }

  if (event.type === 'unknown-structured-entry') {
    return { block: { kind: 'system', text: `Unsupported structured event: ${event.originalType}`, status: 'final', source: 'structured', createdAt: event.createdAt } };
  }

  return { ignored: true };
}

export function mapClaudeJsonlEntryToSemantic(entry: ClaudeJsonlEntry): SemanticBlockPart[] {
  if (entry.type === 'system') return textToBlockParts('system', extractText(entry.content), entry);

  const role = entry.message?.role;
  const content = entry.message?.content;
  if (Array.isArray(content)) return content.flatMap((part) => extractContentPart(role, part, entry));

  const kind = messageRoleToBlockKind(role);
  if (!kind) return [];
  return textToBlockParts(kind, extractText(content), entry);
}

export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(extractText).filter(Boolean).join('\n');
  if (content && typeof content === 'object' && 'text' in content && typeof content.text === 'string') return content.text;
  return '';
}

function extractContentPart(role: string | undefined, part: unknown, entry: ClaudeJsonlEntry): SemanticBlockPart[] {
  if (!part || typeof part !== 'object') return [];
  const type = 'type' in part && typeof part.type === 'string' ? part.type : '';

  if (type === 'tool_use') return textToBlockParts('tool', extractToolUseText(part), entry);
  if (type === 'tool_result') return textToBlockParts('tool', extractText('content' in part ? part.content : undefined), entry);

  const kind = messageRoleToBlockKind(role);
  if (!kind) return [];
  return textToBlockParts(kind, extractText(part), entry);
}

function extractToolUseText(part: object): string {
  const name = 'name' in part && typeof part.name === 'string' ? part.name : 'Tool';
  const input = 'input' in part ? part.input : undefined;
  return toolText(name, input);
}

function textToBlockParts(kind: ConversationBlockKind, text: string, entry: ClaudeJsonlEntry): SemanticBlockPart[] {
  return text ? [{ kind, text, status: 'final', source: 'history', sourceEventId: entry.uuid, createdAt: entry.timestamp }] : [];
}

function messageRoleToBlockKind(role: string | undefined): ConversationBlockKind | null {
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') return role;
  return null;
}

function toolText(name: string, input: unknown): string {
  const command = input && typeof input === 'object' && 'command' in input && typeof input.command === 'string' ? input.command : '';
  return [name, command || safeStringify(input)].filter(Boolean).join('\n');
}

function safeStringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}
