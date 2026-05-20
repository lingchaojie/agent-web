export type ProjectSource = 'whitelist' | 'history' | 'active-client';

export type Project = {
  id: string;
  name: string;
  path: string;
  favorite: boolean;
  available: boolean;
  source: ProjectSource;
  createdAt: string;
  updatedAt: string;
};

export type SessionSource = 'web-created' | 'claude-history' | 'external-tmux';
export type SessionStatus = 'running' | 'stopped' | 'failed';
export type SessionActivity = 'idle' | 'working' | 'stopped';
export type SessionLifecycle = 'running' | 'idle' | 'waiting-for-input' | 'stopping' | 'stopped' | 'failed' | 'degraded-fallback' | 'disconnected';
export type SessionConnection = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export type TranscriptSource = 'structured' | 'pty-fallback' | 'tmux-capture';

export type ClaudeSession = {
  id: string;
  projectId: string;
  source: SessionSource;
  claudeSessionId: string | null;
  externalKey?: string;
  externalPaneId?: string;
  externalCwd?: string;
  title: string;
  status: SessionStatus;
  lastActiveAt: string;
  createdAt: string;
};

export type PromptAction = {
  id: string;
  label: string;
  input: string;
  variant: 'allow' | 'deny' | 'neutral';
};

export type ParsedInteraction = {
  kind: 'none' | 'permission' | 'choice';
  actions: PromptAction[];
  raw: string;
};

export type ConversationBlockKind = 'user' | 'assistant' | 'tool' | 'system' | 'interaction';
export type ConversationBlockStatus = 'streaming' | 'final';
export type ConversationBlockSource = 'live' | 'history' | 'structured' | 'pty-fallback' | 'tmux-capture';

export type ConversationBlock = {
  id: string;
  sessionId: string;
  kind: ConversationBlockKind;
  text: string;
  sequence: number;
  status: ConversationBlockStatus;
  createdAt: string;
  updatedAt: string;
  source: ConversationBlockSource;
  interaction?: ParsedInteraction;
};

export type RenderRegionKind = 'user' | 'assistant' | 'tool' | 'system' | 'interaction';
export type RenderRegionStatus = 'streaming' | 'final';

export type RenderRegion = {
  id: string;
  kind: RenderRegionKind;
  text: string;
  status: RenderRegionStatus;
  source: TranscriptSource | 'history';
  createdAt: string;
  updatedAt: string;
  interaction?: ParsedInteraction;
};

export type TransientStatus = {
  activity: SessionActivity;
  label?: string;
  updatedAt?: string;
};

export type RenderDiagnostic = {
  id: string;
  sourceType: string;
  text: string;
  createdAt?: string;
};

export type SessionRenderState = {
  sessionId: string;
  regions: RenderRegion[];
  activeRegion: RenderRegion | null;
  transientStatus: TransientStatus;
  diagnostics: RenderDiagnostic[];
  transcriptSource: TranscriptSource;
  sequence: number;
};

export type TranscriptWindow = {
  sessionId: string;
  projectKey: string;
  projectPath: string | null;
  title: string;
  updatedAt: string;
  regions: RenderRegion[];
  olderCursor: string | null;
  hasMoreOlder: boolean;
};

export type SessionStatuslineState = {
  sessionId: string;
  status: 'pending' | 'ready' | 'error';
  text: string;
  error?: string;
  updatedAt: string;
  sequence: number;
};

export type SessionViewState = {
  sessionId: string;
  projectId: string;
  title: string;
  lifecycle: SessionLifecycle;
  activity: 'idle' | 'working' | 'stopped';
  activityLabel?: string;
  connection: SessionConnection;
  transcriptSource: TranscriptSource;
  claudeSessionId: string | null;
  latestSequence: number;
  updatedAt: string;
  pendingInteraction: ParsedInteraction | null;
};

export type SessionStreamState = {
  session: SessionViewState | null;
  blocks: ConversationBlock[];
  render?: SessionRenderState;
  statusline?: SessionStatuslineState;
  latestSequence: number;
};

export type SessionStreamEvent =
  | { type: 'snapshot'; sessionId: string; sequence: number; session: SessionViewState; blocks: ConversationBlock[]; render?: SessionRenderState; statusline?: SessionStatuslineState }
  | { type: 'block-added'; sessionId: string; sequence: number; block: ConversationBlock }
  | { type: 'block-updated'; sessionId: string; sequence: number; blockId: string; patch: Partial<Pick<ConversationBlock, 'text' | 'interaction' | 'updatedAt'>> }
  | { type: 'block-finalized'; sessionId: string; sequence: number; blockId: string }
  | { type: 'activity-changed'; sessionId: string; sequence: number; activity: SessionViewState['activity']; activityLabel?: string }
  | { type: 'session-changed'; sessionId: string; sequence: number; patch: Partial<Omit<SessionViewState, 'sessionId'>> }
  | { type: 'render-changed'; sessionId: string; sequence: number; render: SessionRenderState }
  | { type: 'statusline-changed'; sessionId: string; sequence: number; statusline: SessionStatuslineState }
  | { type: 'error'; sessionId?: string; sequence?: number; message: string };

export type HistorySession = {
  projectKey: string;
  projectPath: string | null;
  sessionId: string;
  transcriptPath: string;
  title: string;
  lastMessage: string;
  updatedAt: string;
  blocks: ConversationBlock[];
  appSessionId?: string;
  appSession?: ClaudeSession;
};

export type WsClientMessage =
  | { type: 'subscribe'; sessionId: string; afterSequence?: number }
  | { type: 'input'; sessionId: string; text: string }
  | { type: 'action'; sessionId: string; actionId: string; input: string };

export type SlashCommandScope = 'app' | 'project' | 'user';
export type SlashCommandBehavior = 'app-owned' | 'prompt-insert' | 'unsupported';
export type SlashCommandSupport = 'supported' | 'unsupported';

export type SlashCommandEntry = {
  name: `/${string}`;
  title: string;
  description: string;
  scope: SlashCommandScope;
  behavior: SlashCommandBehavior;
  support: SlashCommandSupport;
  aliases: string[];
};

export type SlashCommandCatalog = {
  projectId: string;
  commands: SlashCommandEntry[];
};

export type ResumeCommandCandidate = {
  sessionId: string;
  title: string;
  lastMessage: string;
  updatedAt: string;
  appSessionId?: string;
};

export type WsServerMessage = SessionStreamEvent | { type: 'error'; sessionId?: string; message: string };
