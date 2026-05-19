import type { RenderRegion, RenderRegionKind, RenderRegionStatus, SessionRenderState } from './types';
import type { ClaudeSemanticEvent } from '../server/services/claudeEventSource';

export function emptySessionRenderState(sessionId: string): SessionRenderState {
  return {
    sessionId,
    regions: [],
    activeRegion: null,
    transientStatus: { activity: 'idle' },
    diagnostics: [],
    transcriptSource: 'structured',
    sequence: 0,
  };
}

export function applyClaudeEventToRenderState(state: SessionRenderState, event: ClaudeSemanticEvent): SessionRenderState {
  const next = { ...state, sequence: Math.max(state.sequence, event.order) };

  if (event.type === 'user-message') return appendRegion(next, regionFromEvent(event.messageId, 'user', event.text, 'final', event.createdAt));

  if (event.type === 'assistant-message-started') {
    return { ...next, activeRegion: regionFromEvent(event.messageId, 'assistant', event.text ?? '', 'streaming', event.createdAt), transientStatus: { activity: 'working', updatedAt: event.createdAt } };
  }

  if (event.type === 'assistant-message-delta') {
    return { ...next, activeRegion: regionFromEvent(event.messageId, 'assistant', event.text ?? '', 'streaming', event.createdAt), transientStatus: { activity: 'working', updatedAt: event.createdAt } };
  }

  if (event.type === 'assistant-message-completed') {
    const region = regionFromEvent(event.messageId, 'assistant', event.text ?? next.activeRegion?.text ?? '', 'final', event.createdAt);
    return appendRegion({ ...next, activeRegion: null, transientStatus: { activity: 'idle', updatedAt: event.createdAt } }, region);
  }

  if (event.type === 'tool-use-started' || event.type === 'tool-use-updated') {
    return { ...next, activeRegion: regionFromEvent(event.toolUseId, 'tool', event.text ?? toolText(event.name, event.input), 'streaming', event.createdAt), transientStatus: { activity: 'working', updatedAt: event.createdAt } };
  }

  if (event.type === 'tool-use-completed') {
    return appendRegion({ ...next, activeRegion: null, transientStatus: { activity: 'idle', updatedAt: event.createdAt } }, regionFromEvent(event.toolUseId, 'tool', event.text ?? toolText(event.name, event.input), 'final', event.createdAt));
  }

  if (event.type === 'permission-requested' || event.type === 'choice-requested') {
    return appendRegion({ ...next, transientStatus: { activity: 'idle', updatedAt: event.createdAt } }, { ...regionFromEvent(event.promptId, 'interaction', event.text, 'final', event.createdAt), interaction: event.interaction });
  }

  if (event.type === 'usage-or-activity-updated') {
    return { ...next, transientStatus: { activity: event.activity, label: event.activityLabel, updatedAt: event.createdAt } };
  }

  if (event.type === 'session-started') return { ...next, transientStatus: { activity: 'idle', updatedAt: event.createdAt } };
  if (event.type === 'session-stopped') return { ...next, transientStatus: { activity: 'idle', updatedAt: event.createdAt } };
  if (event.type === 'session-failed') return { ...next, transientStatus: { activity: 'stopped', label: event.message, updatedAt: event.createdAt } };
  if (event.type === 'structured-source-unavailable') return { ...next, transcriptSource: 'pty-fallback', transientStatus: { activity: 'idle', label: event.message, updatedAt: event.createdAt } };

  if (event.type === 'unknown-structured-entry') {
    return {
      ...next,
      diagnostics: [...next.diagnostics, { id: `${event.originalType}-${event.order}`, sourceType: event.originalType, text: event.text, createdAt: event.createdAt }],
    };
  }

  return next;
}

function appendRegion(state: SessionRenderState, region: RenderRegion): SessionRenderState {
  const regions = state.regions.some((item) => item.id === region.id)
    ? state.regions.map((item) => (item.id === region.id ? region : item))
    : [...state.regions, region];
  return { ...state, regions };
}

function regionFromEvent(id: string, kind: RenderRegionKind, text: string, status: RenderRegionStatus, createdAt = new Date().toISOString()): RenderRegion {
  return { id, kind, text, status, source: 'structured', createdAt, updatedAt: createdAt };
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
