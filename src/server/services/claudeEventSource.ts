import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ConversationBlockKind, ParsedInteraction, PromptAction, SessionActivity, SessionLifecycle } from '../../shared/types';

export type ClaudeEventSourceMode = 'structured' | 'pty-fallback';

export type ClaudeEventSourceCapability = {
  source: 'cli-stream-json';
  available: boolean;
  command: string[];
  supports: {
    stableSessionId: boolean;
    stableMessageId: boolean;
    orderedEvents: boolean;
    partialAssistantDeltas: boolean;
    toolUseEvents: boolean;
    hookEvents: boolean;
    permissionPromptEvents: boolean;
    streamingInput: boolean;
  };
  permissionFallback: 'pty-interaction';
  notes: string[];
};

export type ClaudeEventSourceDiscovery = {
  selected: ClaudeEventSourceMode;
  capabilities: ClaudeEventSourceCapability[];
};

export type ClaudeEventSourceStartInput =
  | { sessionId: string; cwd: string; mode: 'new' }
  | { sessionId: string; cwd: string; mode: 'continue' }
  | { sessionId: string; cwd: string; mode: 'resume'; claudeSessionId: string };

export type ClaudeLifecycleEvent = {
  type: 'session-started' | 'session-stopped' | 'session-failed' | 'structured-source-unavailable';
  sessionId: string;
  source: ClaudeEventSourceMode;
  lifecycle?: SessionLifecycle;
  message?: string;
  exitCode?: number;
  order: number;
  createdAt: string;
};

export type ClaudeSessionIdentityEvent = {
  type: 'session-identity-observed';
  sessionId: string;
  claudeSessionId: string;
  order: number;
  createdAt: string;
};

export type ClaudeUserMessageEvent = {
  type: 'user-message';
  sessionId: string;
  messageId: string;
  text: string;
  order: number;
  createdAt: string;
};

export type ClaudeAssistantEvent = {
  type: 'assistant-message-started' | 'assistant-message-delta' | 'assistant-message-completed';
  sessionId: string;
  messageId: string;
  text?: string;
  order: number;
  createdAt: string;
};

export type ClaudeToolEvent = {
  type: 'tool-use-started' | 'tool-use-updated' | 'tool-use-completed';
  sessionId: string;
  toolUseId: string;
  name: string;
  input?: unknown;
  text?: string;
  order: number;
  createdAt: string;
};

export type ClaudeInteractionEvent = {
  type: 'permission-requested' | 'choice-requested';
  sessionId: string;
  promptId: string;
  text: string;
  interaction: ParsedInteraction;
  order: number;
  createdAt: string;
};

export type ClaudeActivityEvent = {
  type: 'usage-or-activity-updated';
  sessionId: string;
  activity: SessionActivity;
  activityLabel?: string;
  order: number;
  createdAt: string;
};

export type ClaudeUnknownEvent = {
  type: 'unknown-structured-entry';
  sessionId: string;
  originalType: string;
  text: string;
  order: number;
  createdAt: string;
};

export type ClaudeSemanticEvent =
  | ClaudeLifecycleEvent
  | ClaudeSessionIdentityEvent
  | ClaudeUserMessageEvent
  | ClaudeAssistantEvent
  | ClaudeToolEvent
  | ClaudeInteractionEvent
  | ClaudeActivityEvent
  | ClaudeUnknownEvent;

export type ClaudeEventSink = (event: ClaudeSemanticEvent) => void;

export interface ClaudeEventSource {
  discover(): ClaudeEventSourceDiscovery;
  start(input: ClaudeEventSourceStartInput): void;
  onEvent(sessionId: string, callback: ClaudeEventSink): void;
  onFallbackOutput(sessionId: string, callback: (data: string) => void): void;
  onExit(sessionId: string, callback: (event: { exitCode: number; signal?: number }) => void): void;
  sendInput(sessionId: string, text: string): void;
  stop(sessionId: string): void;
  isRunning(sessionId: string): boolean;
  modeForSession(sessionId: string): ClaudeEventSourceMode;
}

export type ClaudeStreamJsonRaw = {
  type?: string;
  subtype?: string;
  status?: string;
  session_id?: string;
  uuid?: string;
  message?: {
    id?: string;
    role?: string;
    content?: unknown;
    stop_reason?: string;
  };
  event?: {
    type?: string;
    index?: number;
    message?: {
      id?: string;
      role?: string;
    };
    content_block?: {
      type?: string;
      id?: string;
      name?: string;
      input?: unknown;
      text?: string;
    };
    delta?: {
      type?: string;
      text?: string;
      partial_json?: string;
      stop_reason?: string;
    };
    usage?: unknown;
  };
  result?: string;
  is_error?: boolean;
  exitCode?: number;
};

type StreamState = {
  messageId: string | null;
  nativeSessionId: string | null;
  textByIndex: Map<number, string>;
  toolByIndex: Map<number, { id: string; name: string; inputJson: string }>;
};

type RunningSession = {
  input: ClaudeEventSourceStartInput;
  proc: ChildProcessWithoutNullStreams | null;
  active: boolean;
};

export function discoverClaudeEventSource(claudeBin = 'claude'): ClaudeEventSourceDiscovery {
  return {
    selected: 'structured',
    capabilities: [{
      source: 'cli-stream-json',
      available: true,
      command: [claudeBin, '-p', '--verbose', '--input-format=stream-json', '--output-format=stream-json', '--include-partial-messages', '--include-hook-events'],
      supports: {
        stableSessionId: true,
        stableMessageId: true,
        orderedEvents: true,
        partialAssistantDeltas: true,
        toolUseEvents: true,
        hookEvents: true,
        permissionPromptEvents: false,
        streamingInput: true,
      },
      permissionFallback: 'pty-interaction',
      notes: [
        'Claude Code help exposes --output-format=stream-json, --input-format=stream-json, --include-partial-messages, and --include-hook-events.',
        'stream-json requires --verbose and emits newline-delimited events with UUIDs, session_id, message ids, partial text deltas, tool_use blocks, hook events, and result events.',
        'Permission prompts are not documented as distinct stream-json events; PTY interaction parsing remains the fallback boundary for prompts not represented structurally.',
      ],
    }],
  };
}

export function parseClaudeStreamJsonLine(line: string, fallbackSessionId: string, order: number, state: StreamState = createStreamState()): ClaudeSemanticEvent[] {
  const parsed = parseJson(line);
  if (!parsed) return [];
  return mapClaudeStreamJson(parsed, fallbackSessionId, order, state);
}

export function createStreamState(nativeSessionId: string | null = null): StreamState {
  return { messageId: null, nativeSessionId, textByIndex: new Map(), toolByIndex: new Map() };
}

export function mapClaudeStreamJson(raw: ClaudeStreamJsonRaw, fallbackSessionId: string, order: number, state: StreamState = createStreamState()): ClaudeSemanticEvent[] {
  const sessionId = raw.session_id ?? state.nativeSessionId ?? fallbackSessionId;
  const createdAt = new Date().toISOString();
  const events = nativeSessionIdentityEvents(raw, sessionId, order, createdAt, state);

  if (raw.type === 'system' && raw.subtype === 'init') {
    events.push({ type: 'session-started', sessionId, source: 'structured', lifecycle: 'running', order, createdAt });
    return events;
  }

  if (raw.type === 'system' && raw.subtype?.startsWith('hook_')) {
    events.push({ type: 'usage-or-activity-updated', sessionId, activity: 'working', activityLabel: hookLabel(raw.subtype), order, createdAt });
    return events;
  }

  if (raw.type === 'system' && raw.subtype === 'status') {
    events.push({ type: 'usage-or-activity-updated', sessionId, activity: 'working', activityLabel: statusLabel(raw), order, createdAt });
    return events;
  }

  if (raw.type === 'stream_event' && raw.event) {
    events.push(...mapApiStreamEvent(raw, sessionId, order, createdAt, state));
    return events;
  }

  if (raw.type === 'assistant' && raw.message?.role === 'assistant') return events;

  if (raw.type === 'user' && raw.message?.role === 'user') {
    const text = assistantText(raw.message.content);
    if (!text) return events;
    events.push({ type: 'user-message', sessionId, messageId: raw.uuid ?? `user-${order}`, text, order, createdAt });
    return events;
  }

  if (raw.type === 'result') {
    const lifecycle = raw.is_error ? 'failed' : 'stopped';
    events.push({ type: raw.is_error ? 'session-failed' : 'session-stopped', sessionId, source: 'structured', lifecycle, message: raw.result, order, createdAt });
    return events;
  }

  events.push({ type: 'unknown-structured-entry', sessionId, originalType: raw.type ?? 'unknown', text: raw.type ?? 'unknown structured event', order, createdAt });
  return events;
}

export class StreamJsonClaudeEventSource implements ClaudeEventSource {
  private readonly sessions = new Map<string, RunningSession>();
  private readonly eventCallbacks = new Map<string, Set<ClaudeEventSink>>();
  private readonly fallbackCallbacks = new Map<string, Set<(data: string) => void>>();
  private readonly exitCallbacks = new Map<string, Set<(event: { exitCode: number; signal?: number }) => void>>();
  private readonly buffers = new Map<string, string>();
  private readonly states = new Map<string, StreamState>();
  private readonly orders = new Map<string, number>();

  constructor(private readonly options: { claudeBin: string; spawn?: typeof spawn }) {}

  discover(): ClaudeEventSourceDiscovery {
    return discoverClaudeEventSource(this.options.claudeBin);
  }

  start(input: ClaudeEventSourceStartInput): void {
    if (this.sessions.has(input.sessionId)) throw new Error('Session already running');

    this.sessions.set(input.sessionId, { input, proc: null, active: true });
    this.buffers.set(input.sessionId, '');
    this.states.set(input.sessionId, createStreamState(input.mode === 'resume' ? input.claudeSessionId : null));
    this.orders.set(input.sessionId, 0);
    this.spawnTurn(input.sessionId, null);
  }

  onEvent(sessionId: string, callback: ClaudeEventSink): void {
    const callbacks = this.eventCallbacks.get(sessionId) ?? new Set<ClaudeEventSink>();
    callbacks.add(callback);
    this.eventCallbacks.set(sessionId, callbacks);
  }

  onFallbackOutput(sessionId: string, callback: (data: string) => void): void {
    const callbacks = this.fallbackCallbacks.get(sessionId) ?? new Set<(data: string) => void>();
    callbacks.add(callback);
    this.fallbackCallbacks.set(sessionId, callbacks);
  }

  onExit(sessionId: string, callback: (event: { exitCode: number; signal?: number }) => void): void {
    const callbacks = this.exitCallbacks.get(sessionId) ?? new Set<(event: { exitCode: number; signal?: number }) => void>();
    callbacks.add(callback);
    this.exitCallbacks.set(sessionId, callbacks);
  }

  sendInput(sessionId: string, text: string): void {
    const session = this.sessions.get(sessionId);
    if (!session?.active) throw new Error('Session is not running');
    const proc = session.proc ?? this.spawnTurn(sessionId, 'continue');
    this.writeInput(proc, text);
  }

  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.active = false;
    session.proc?.kill();
    this.sessions.delete(sessionId);
  }

  isRunning(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.active ?? false;
  }

  modeForSession(): ClaudeEventSourceMode {
    return 'structured';
  }

  private spawnTurn(sessionId: string, mode: 'continue' | null): ChildProcessWithoutNullStreams {
    const session = this.sessions.get(sessionId);
    if (!session?.active) throw new Error('Session is not running');
    if (session.proc) return session.proc;

    const nativeSessionId = this.states.get(sessionId)?.nativeSessionId;
    const input = mode && nativeSessionId
      ? { sessionId, cwd: session.input.cwd, mode: 'resume', claudeSessionId: nativeSessionId } as ClaudeEventSourceStartInput
      : mode ? { sessionId, cwd: session.input.cwd, mode } as ClaudeEventSourceStartInput : session.input;
    const args = streamJsonArgsFor(input);
    const spawnFn = this.options.spawn ?? spawn;
    const proc = spawnFn(this.options.claudeBin, args, { cwd: input.cwd, env: process.env });
    session.proc = proc;
    this.buffers.set(sessionId, '');
    this.states.set(sessionId, createStreamState(input.mode === 'resume' ? input.claudeSessionId : this.states.get(sessionId)?.nativeSessionId ?? null));

    proc.stdout.on('data', (chunk: Buffer | string) => this.handleStdout(sessionId, chunk.toString()));
    proc.stderr.on('data', (chunk: Buffer | string) => this.emitFallback(sessionId, chunk.toString()));
    proc.on('exit', (code) => {
      if (session.proc === proc) session.proc = null;
      const event = { exitCode: code ?? 0 };
      for (const callback of this.exitCallbacks.get(sessionId) ?? []) callback(event);
      if (event.exitCode !== 0) {
        session.active = false;
        this.sessions.delete(sessionId);
      }
    });
    return proc;
  }

  private writeInput(proc: ChildProcessWithoutNullStreams, text: string): void {
    proc.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })}\n`);
  }

  private handleStdout(sessionId: string, chunk: string): void {
    const text = `${this.buffers.get(sessionId) ?? ''}${chunk}`;
    const lines = text.split(/\r?\n/);
    this.buffers.set(sessionId, lines.pop() ?? '');
    for (const line of lines) {
      if (!line.trim()) continue;
      const order = (this.orders.get(sessionId) ?? 0) + 1;
      this.orders.set(sessionId, order);
      const state = this.states.get(sessionId) ?? createStreamState();
      this.states.set(sessionId, state);
      const events = parseClaudeStreamJsonLine(line, sessionId, order, state);
      for (const event of events) this.emitEvent(sessionId, event);
    }
  }

  private emitEvent(sessionId: string, event: ClaudeSemanticEvent): void {
    for (const callback of this.eventCallbacks.get(sessionId) ?? []) callback(event);
  }

  private emitFallback(sessionId: string, data: string): void {
    for (const callback of this.fallbackCallbacks.get(sessionId) ?? []) callback(data);
  }
}

function nativeSessionIdentityEvents(raw: ClaudeStreamJsonRaw, sessionId: string, order: number, createdAt: string, state: StreamState): ClaudeSemanticEvent[] {
  if (!raw.session_id || raw.session_id === state.nativeSessionId) return [];
  state.nativeSessionId = raw.session_id;
  return [{ type: 'session-identity-observed', sessionId, claudeSessionId: raw.session_id, order, createdAt }];
}

function mapApiStreamEvent(raw: ClaudeStreamJsonRaw, sessionId: string, order: number, createdAt: string, state: StreamState): ClaudeSemanticEvent[] {
  const event = raw.event;
  if (!event) return [];

  if (event.type === 'message_start') {
    state.messageId = event.message?.id ?? `assistant-${order}`;
    return [{ type: 'assistant-message-started', sessionId, messageId: state.messageId, text: '', order, createdAt }];
  }

  if (event.type === 'content_block_start') {
    if (event.content_block?.type === 'text') {
      state.textByIndex.set(event.index ?? 0, '');
      return [];
    }
    if (event.content_block?.type === 'thinking') {
      state.textByIndex.delete(event.index ?? 0);
      return [{ type: 'usage-or-activity-updated', sessionId, activity: 'working', activityLabel: 'Thinking', order, createdAt }];
    }
    if (event.content_block?.type === 'tool_use') {
      const toolUseId = event.content_block.id ?? `tool-${order}`;
      const name = event.content_block.name ?? 'Tool';
      state.toolByIndex.set(event.index ?? 0, { id: toolUseId, name, inputJson: '' });
      return [{ type: 'tool-use-started', sessionId, toolUseId, name, input: event.content_block.input, order, createdAt }];
    }
  }

  if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
    const index = event.index ?? 0;
    const current = state.textByIndex.get(index) ?? '';
    const next = `${current}${event.delta.text ?? ''}`;
    state.textByIndex.set(index, next);
    return [{ type: 'assistant-message-delta', sessionId, messageId: state.messageId ?? `assistant-${order}`, text: next, order, createdAt }];
  }

  if (event.type === 'content_block_delta' && isThinkingDelta(event.delta?.type)) return [];

  if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
    const index = event.index ?? 0;
    const tool = state.toolByIndex.get(index);
    if (!tool) return [];
    tool.inputJson += event.delta.partial_json ?? '';
    return [{ type: 'tool-use-updated', sessionId, toolUseId: tool.id, name: tool.name, input: parseJson(tool.inputJson), text: toolText(tool.name, parseJson(tool.inputJson)), order, createdAt }];
  }

  if (event.type === 'content_block_stop') {
    const index = event.index ?? 0;
    if (state.textByIndex.has(index)) {
      const text = state.textByIndex.get(index) ?? '';
      state.textByIndex.delete(index);
      return text ? [{ type: 'assistant-message-completed', sessionId, messageId: state.messageId ?? `assistant-${order}`, text, order, createdAt }] : [];
    }
    if (!state.toolByIndex.has(index)) return [];
    const tool = state.toolByIndex.get(index);
    if (tool) {
      const input = parseJson(tool.inputJson);
      state.toolByIndex.delete(index);
      return [{ type: 'tool-use-completed', sessionId, toolUseId: tool.id, name: tool.name, input, text: toolText(tool.name, input), order, createdAt }];
    }
  }

  if (event.type === 'message_delta') {
    return [{ type: 'usage-or-activity-updated', sessionId, activity: event.delta?.stop_reason ? 'idle' : 'working', activityLabel: usageLabel(event.usage), order, createdAt }];
  }

  if (event.type === 'message_stop') {
    return [{ type: 'usage-or-activity-updated', sessionId, activity: 'idle', order, createdAt }];
  }

  return [{ type: 'unknown-structured-entry', sessionId, originalType: event.type ?? 'stream_event', text: event.type ?? 'unknown stream event', order, createdAt }];
}

function streamJsonArgsFor(input: ClaudeEventSourceStartInput): string[] {
  const args = ['-p', '--verbose', '--input-format=stream-json', '--output-format=stream-json', '--include-partial-messages', '--include-hook-events'];
  if (input.mode === 'continue') args.push('-c');
  if (input.mode === 'resume') args.push('-r', input.claudeSessionId);
  return args;
}

function assistantText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (!part || typeof part !== 'object') return '';
    if ('type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string') return part.text;
    return '';
  }).filter(Boolean).join('\n');
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

function parseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function hookLabel(subtype: string): string {
  return subtype.replace(/^hook_/, 'hook ');
}

function statusLabel(raw: ClaudeStreamJsonRaw): string | undefined {
  return 'status' in raw && typeof raw.status === 'string' ? raw.status : undefined;
}

function isThinkingDelta(type: string | undefined): boolean {
  return type === 'thinking_delta' || type === 'signature_delta';
}

function usageLabel(usage: unknown): string | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const inputTokens = 'input_tokens' in usage && typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined;
  const outputTokens = 'output_tokens' in usage && typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined;
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return `↑ ${inputTokens ?? 0} / ↓ ${outputTokens ?? 0}`;
}

export function blockKindForClaudeEntry(role: string | undefined, contentType?: string): ConversationBlockKind | null {
  if (contentType === 'tool_use' || contentType === 'tool_result') return 'tool';
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') return role;
  return null;
}

export function actionToInteraction(text: string, actions: PromptAction[], kind: 'permission' | 'choice' = 'choice'): ParsedInteraction {
  return { kind, actions, raw: text };
}
