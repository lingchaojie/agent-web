import type { ClaudeSession, HistorySession, Project, SlashCommandCatalog, TerminalClientMessage, TranscriptWindow, WsClientMessage } from '../shared/types';

const TOKEN_KEY = 'webagent.token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(token: string): void {
  const trimmed = token.trim();
  if (trimmed) {
    localStorage.setItem(TOKEN_KEY, trimmed);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: authHeaders(),
  });
  return readJsonResponse<T>(response);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  });
  return readJsonResponse<T>(response);
}

export async function checkAuth(): Promise<boolean> {
  try {
    const result = await apiGet<{ ok: boolean }>('/api/auth/check');
    return result.ok;
  } catch {
    return false;
  }
}

export function listProjects(): Promise<Project[]> {
  return apiGet<Project[]>('/api/projects');
}

export function listSessions(projectId: string): Promise<ClaudeSession[]> {
  return apiGet<ClaudeSession[]>(`/api/projects/${encodeURIComponent(projectId)}/sessions`);
}

export function listHistory(): Promise<HistorySession[]> {
  return apiGet<HistorySession[]>('/api/history');
}

export function loadHistoryTranscript(sessionId: string, input: { limit?: number; before?: string } = {}): Promise<TranscriptWindow> {
  return apiGet<TranscriptWindow>(`/api/history/${encodeURIComponent(sessionId)}/transcript${queryString(input)}`);
}

export function loadSessionTranscript(sessionId: string, input: { limit?: number; before?: string } = {}): Promise<TranscriptWindow> {
  return apiGet<TranscriptWindow>(`/api/sessions/${encodeURIComponent(sessionId)}/transcript${queryString(input)}`);
}

export function listSlashCommands(projectId: string): Promise<SlashCommandCatalog> {
  return apiGet<SlashCommandCatalog>(`/api/projects/${encodeURIComponent(projectId)}/slash-commands`);
}

export function createSession(projectId: string): Promise<ClaudeSession> {
  return apiPost<ClaudeSession>('/api/sessions', { projectId, mode: 'new' });
}

export function continueSession(projectId: string): Promise<ClaudeSession> {
  return apiPost<ClaudeSession>('/api/sessions', { projectId, mode: 'continue' });
}

export function resumeSession(projectId: string, claudeSessionId: string, title: string): Promise<ClaudeSession> {
  return apiPost<ClaudeSession>('/api/sessions/resume', { projectId, claudeSessionId, title });
}

export function stopSession(sessionId: string): Promise<ClaudeSession> {
  return apiPost<ClaudeSession>(`/api/sessions/${encodeURIComponent(sessionId)}/stop`, {});
}

export function openSessionSocket(): WebSocket {
  return openWebSocket('/api/ws');
}

export function openTerminalSocket(): WebSocket {
  return openWebSocket('/api/terminal/ws');
}

export function sendWs(socket: WebSocket, message: WsClientMessage): void {
  sendJsonWs(socket, message);
}

export function sendTerminalWs(socket: WebSocket, message: TerminalClientMessage): void {
  sendJsonWs(socket, message);
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep status-based message when the response is not JSON.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

function queryString(input: { limit?: number; before?: string }): string {
  const params = new URLSearchParams();
  if (input.limit !== undefined) params.set('limit', String(input.limit));
  if (input.before) params.set('before', input.before);
  const query = params.toString();
  return query ? `?${query}` : '';
}

function openWebSocket(path: string): WebSocket {
  const token = getToken();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}${path}`;

  if (!token) return new WebSocket(url, ['webagent']);

  return new WebSocket(url, ['webagent', `token.${base64url(token)}`]);
}

function sendJsonWs(socket: WebSocket, message: WsClientMessage | TerminalClientMessage): void {
  if (socket.readyState !== WebSocket.OPEN) {
    throw new Error('WebSocket is not connected');
  }
  socket.send(JSON.stringify(message));
}

function base64url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
