import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClaudeSession, HistorySession, Project, SessionStatus, SlashCommandEntry, TranscriptWindow } from '../shared/types';
import {
  checkAuth,
  continueSession,
  createSession,
  listHistory,
  listProjects,
  listSessions,
  listSlashCommands,
  loadHistoryTranscript,
  loadSessionTranscript,
  resumeSession,
  stopSession,
} from './api';
import ChatView from './components/ChatView';
import LoginView from './components/LoginView';
import ProjectList from './components/ProjectList';
import SessionList from './components/SessionList';

type MobilePane = 'projects' | 'sessions' | 'chat';
type SelectedHistorySession = { id: string; title: string; status: 'stopped'; historySessionId: string };

type SelectedChat =
  | { kind: 'session'; session: ClaudeSession }
  | { kind: 'history'; session: SelectedHistorySession };

const TRANSCRIPT_PAGE_SIZE = 50;

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [slashCommands, setSlashCommands] = useState<SlashCommandEntry[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => localStorage.getItem('webagent.selectedProjectId'));
  const [selectedChat, setSelectedChat] = useState<SelectedChat | null>(null);
  const [transcript, setTranscript] = useState<TranscriptWindow | null>(null);
  const [transcriptLoadingOlder, setTranscriptLoadingOlder] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>(() => (localStorage.getItem('webagent.selectedSessionId') ? 'chat' : 'projects'));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sessionRequestIdRef = useRef(0);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const filteredHistory = useMemo(
    () => history.filter((session) => session.projectPath === selectedProject?.path),
    [history, selectedProject?.path],
  );

  useEffect(() => {
    checkAuth().then((ok) => {
      setAuthenticated(ok);
      setCheckingAuth(false);
    });
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    refreshProjectsAndHistory();
  }, [authenticated]);

  useEffect(() => {
    if (!selectedProjectId) {
      sessionRequestIdRef.current += 1;
      setSelectedChat(null);
      setTranscript(null);
      setSessions([]);
      setSlashCommands([]);
      localStorage.removeItem('webagent.selectedProjectId');
      return;
    }
    localStorage.setItem('webagent.selectedProjectId', selectedProjectId);
    refreshSessions(selectedProjectId);
    refreshSlashCommands(selectedProjectId);
  }, [selectedProjectId]);

  async function refreshProjectsAndHistory() {
    setLoading(true);
    setError('');
    try {
      const [nextProjects, nextHistory] = await Promise.all([listProjects(), listHistory()]);
      setProjects(nextProjects);
      setHistory(nextHistory);
      setSelectedProjectId((current) => {
        if (current && nextProjects.some((project) => project.id === current)) return current;
        return nextProjects.find((project) => project.available)?.id ?? nextProjects[0]?.id ?? null;
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshSlashCommands(projectId: string) {
    try {
      const catalog = await listSlashCommands(projectId);
      if (selectedProjectId === projectId) setSlashCommands(catalog.commands);
    } catch {
      setSlashCommands([]);
    }
  }

  async function refreshSessions(projectId: string) {
    const requestId = ++sessionRequestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const nextSessions = await listSessions(projectId);
      if (sessionRequestIdRef.current !== requestId || selectedProjectId !== projectId) return;
      setSessions(nextSessions);
      restoreSelectedSession(nextSessions);
    } catch (err) {
      if (sessionRequestIdRef.current !== requestId || selectedProjectId !== projectId) return;
      setError(errorMessage(err));
    } finally {
      if (sessionRequestIdRef.current === requestId && selectedProjectId === projectId) {
        setLoading(false);
      }
    }
  }

  function handleProjectSelect(project: Project) {
    if (project.id !== selectedProjectId) {
      sessionRequestIdRef.current += 1;
      setSelectedChat(null);
      setTranscript(null);
      setSessions([]);
      setSlashCommands([]);
      setSelectedProjectId(project.id);
      localStorage.removeItem('webagent.selectedSessionId');
    }
    setMobilePane('sessions');
  }

  async function startSession(mode: 'new' | 'continue') {
    if (!selectedProject) return;
    const projectId = selectedProject.id;
    const requestId = ++sessionRequestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const session = mode === 'new' ? await createSession(projectId) : await continueSession(projectId);
      if (sessionRequestIdRef.current !== requestId || selectedProjectId !== projectId) return;
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
      void selectSession(session);
    } catch (err) {
      if (sessionRequestIdRef.current !== requestId || selectedProjectId !== projectId) return;
      setError(errorMessage(err));
    } finally {
      if (sessionRequestIdRef.current === requestId && selectedProjectId === projectId) {
        setLoading(false);
      }
    }
  }

  async function handleResume(historySession: HistorySession) {
    if (!selectedProject) return;
    const projectId = selectedProject.id;
    const requestId = ++sessionRequestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const session = await resumeSession(projectId, historySession.sessionId, historySession.title);
      if (sessionRequestIdRef.current !== requestId || selectedProjectId !== projectId) return;
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
      void selectSession(session);
    } catch (err) {
      if (sessionRequestIdRef.current !== requestId || selectedProjectId !== projectId) return;
      setError(errorMessage(err));
    } finally {
      if (sessionRequestIdRef.current === requestId && selectedProjectId === projectId) {
        setLoading(false);
      }
    }
  }

  function handleSessionOpen(session: ClaudeSession) {
    void selectSession(session);
  }

  function handleHistoryOpen(historySession: HistorySession) {
    void selectHistorySession(historySession);
  }

  function handleHistoryCommandOpen(historySession: HistorySession) {
    if (historySession.appSession) {
      void selectSession(historySession.appSession);
      return;
    }
    void handleResume(historySession);
  }

  async function selectSession(session: ClaudeSession) {
    setSelectedChat({ kind: 'session', session });
    setTranscript(null);
    setMobilePane('chat');
    localStorage.setItem('webagent.selectedSessionId', session.id);
    if (!session.claudeSessionId) return;
    try {
      setTranscript(await loadSessionTranscript(session.id, { limit: TRANSCRIPT_PAGE_SIZE }));
    } catch {
      setTranscript(null);
    }
  }

  async function selectHistorySession(historySession: HistorySession) {
    const session = { id: `history:${historySession.sessionId}`, title: historySession.title, status: 'stopped' as const, historySessionId: historySession.sessionId };
    setSelectedChat({ kind: 'history', session });
    setTranscript(null);
    setMobilePane('chat');
    localStorage.removeItem('webagent.selectedSessionId');
    try {
      setTranscript(await loadHistoryTranscript(historySession.sessionId, { limit: TRANSCRIPT_PAGE_SIZE }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function restoreSelectedSession(sessions: ClaudeSession[]) {
    const storedSessionId = localStorage.getItem('webagent.selectedSessionId');
    const session = sessions.find((item) => item.id === storedSessionId) ?? null;
    if (session) void selectSession(session);
  }

  async function handleStopSession(session: ClaudeSession) {
    setLoading(true);
    setError('');
    try {
      await stopSession(session.id);
      setSessions((current) => current.filter((item) => item.id !== session.id));
      setSelectedChat((current) => {
        if (current?.kind !== 'session' || current.session.id !== session.id) return current;
        localStorage.removeItem('webagent.selectedSessionId');
        setTranscript(null);
        return null;
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function handleStatusChange(sessionId: string, status: SessionStatus) {
    setSessions((current) => current.map((session) => (session.id === sessionId ? { ...session, status } : session)));
    setSelectedChat((current) => (current?.kind === 'session' && current.session.id === sessionId ? { kind: 'session', session: { ...current.session, status } } : current));
  }

  async function loadOlderTranscript() {
    if (!transcript?.hasMoreOlder || transcriptLoadingOlder || !selectedChat) return;
    setTranscriptLoadingOlder(true);
    try {
      const older = selectedChat.kind === 'history'
        ? await loadHistoryTranscript(selectedChat.session.historySessionId, { limit: TRANSCRIPT_PAGE_SIZE, before: transcript.olderCursor ?? undefined })
        : await loadSessionTranscript(selectedChat.session.id, { limit: TRANSCRIPT_PAGE_SIZE, before: transcript.olderCursor ?? undefined });
      setTranscript((current) => current ? { ...older, regions: [...older.regions, ...current.regions] } : older);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTranscriptLoadingOlder(false);
    }
  }

  if (checkingAuth) {
    return (
      <main className="login-shell">
        <section className="panel login-card">
          <p className="eyebrow">Mobile command deck</p>
          <h1>Checking token...</h1>
        </section>
      </main>
    );
  }

  if (!authenticated) {
    return <LoginView onAuthenticated={() => setAuthenticated(true)} />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Claude Code</p>
          <h1>移动控制台</h1>
        </div>
        <button className="secondary-button compact" type="button" onClick={refreshProjectsAndHistory} disabled={loading}>
          刷新
        </button>
      </header>

      {error ? <div className="error-banner global-error">{error}</div> : null}

      <div className="native-shell" data-native-shell="app" data-mobile-pane={mobilePane}>
        <aside className="workspace-sidebar" aria-label="工作区">
          <ProjectList projects={projects} selectedProjectId={selectedProjectId} onSelect={handleProjectSelect} />
        </aside>
        <aside className="session-rail" aria-label="会话">
          <SessionList
            project={selectedProject}
            sessions={sessions}
            history={filteredHistory}
            loading={loading}
            selectedSessionId={selectedChat?.kind === 'session' ? selectedChat.session.id : null}
            onNew={() => startSession('new')}
            onContinue={() => startSession('continue')}
            onResume={handleResume}
            onOpen={handleSessionOpen}
            onOpenHistory={handleHistoryOpen}
            onStop={handleStopSession}
            onBackToProjects={() => setMobilePane('projects')}
          />
        </aside>
        <section className="conversation-canvas" aria-label="对话">
          <ChatView
            session={selectedChat?.kind === 'session' ? selectedChat.session : selectedChat?.session ?? null}
            transcript={transcript}
            transcriptLoadingOlder={transcriptLoadingOlder}
            commandEntries={slashCommands}
            resumeCandidates={filteredHistory}
            onLoadOlderTranscript={loadOlderTranscript}
            onOpenHistorySession={handleHistoryCommandOpen}
            onStatusChange={handleStatusChange}
            onBackToSessions={() => setMobilePane('sessions')}
            onStop={handleStopSession}
          />
        </section>
      </div>
    </main>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}
