export type Project = {
  id: string;
  name: string;
  path: string;
  favorite: boolean;
  available: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SessionSource = 'web-created' | 'claude-history';
export type SessionStatus = 'running' | 'stopped' | 'failed';

export type ClaudeSession = {
  id: string;
  projectId: string;
  source: SessionSource;
  claudeSessionId: string | null;
  title: string;
  status: SessionStatus;
  lastActiveAt: string;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  text: string;
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

export type HistorySession = {
  projectKey: string;
  projectPath: string | null;
  sessionId: string;
  transcriptPath: string;
  title: string;
  lastMessage: string;
  updatedAt: string;
};

export type WsClientMessage =
  | { type: 'attach'; sessionId: string }
  | { type: 'input'; sessionId: string; text: string }
  | { type: 'action'; sessionId: string; actionId: string; input: string };

export type WsServerMessage =
  | { type: 'attached'; sessionId: string; status: SessionStatus; replay: ChatMessage[] }
  | { type: 'output'; sessionId: string; message: ChatMessage; interaction: ParsedInteraction }
  | { type: 'status'; sessionId: string; status: SessionStatus }
  | { type: 'error'; sessionId?: string; message: string };
