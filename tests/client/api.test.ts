/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listSlashCommands, openTerminalSocket, sendTerminalWs, setToken } from '../../src/client/api';

describe('client API helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetches project-scoped slash commands with auth headers', async () => {
    setToken('test-token');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ projectId: 'project-1', commands: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const catalog = await listSlashCommands('project/1');

    expect(catalog).toEqual({ projectId: 'project-1', commands: [] });
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project%2F1/slash-commands', {
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  it('opens terminal websocket with the same protocol token auth format', () => {
    setToken('test-token');
    const sockets: Array<{ url: string | URL; protocols?: string | string[] }> = [];
    class FakeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        sockets.push({ url, protocols });
      }
    }
    vi.stubGlobal('WebSocket', FakeSocket);
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', host: 'localhost:8787' },
      configurable: true,
    });

    openTerminalSocket();

    expect(sockets).toEqual([{ url: 'ws://localhost:8787/api/terminal/ws', protocols: ['webagent', 'token.dGVzdC10b2tlbg'] }]);
  });

  it('sends terminal websocket messages as JSON only when connected', () => {
    const socket = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;

    sendTerminalWs(socket, { type: 'input', sessionId: 'session-1', data: '\x03' });

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'input', sessionId: 'session-1', data: '\x03' }));
  });

  it('rejects terminal websocket sends when disconnected', () => {
    const socket = { readyState: WebSocket.CLOSED, send: vi.fn() } as unknown as WebSocket;

    expect(() => sendTerminalWs(socket, { type: 'detach', sessionId: 'session-1' })).toThrow('WebSocket is not connected');
  });
});
