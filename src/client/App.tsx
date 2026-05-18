import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClaudeSession, HistorySession, Project, SessionStatus } from '../shared/types';
import {
  checkAuth,
  continueSession,
  createSession,
  listHistory,
  listProjects,
  listSessions,
  resumeSession,
} from './api';
import ChatView from './components/ChatView';
import LoginView from './components/LoginView';
import ProjectList from './components/ProjectList';
import SessionList from './components/SessionList';

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<ClaudeSession | null>(null);
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
      setSelectedSession(null);
      setSessions([]);
      return;
    }
    refreshSessions(selectedProjectId);
  }, [selectedProjectId]);

  async function refreshProjectsAndHistory() {
    setLoading(true);
    setError('');
    try {
      const [nextProjects, nextHistory] = await Promise.all([listProjects(), listHistory()]);
      setProjects(nextProjects);
      setHistory(nextHistory);
      setSelectedProjectId((current) => current ?? nextProjects.find((project) => project.available)?.id ?? nextProjects[0]?.id ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
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
    if (project.id === selectedProjectId) return;
    sessionRequestIdRef.current += 1;
    setSelectedSession(null);
    setSessions([]);
    setSelectedProjectId(project.id);
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
      setSelectedSession(session);
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
      setSelectedSession(session);
    } catch (err) {
      if (sessionRequestIdRef.current !== requestId || selectedProjectId !== projectId) return;
      setError(errorMessage(err));
    } finally {
      if (sessionRequestIdRef.current === requestId && selectedProjectId === projectId) {
        setLoading(false);
      }
    }
  }

  function handleStatusChange(sessionId: string, status: SessionStatus) {
    setSessions((current) => current.map((session) => (session.id === sessionId ? { ...session, status } : session)));
    setSelectedSession((current) => (current?.id === sessionId ? { ...current, status } : current));
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
          <h1>Mobile Controller</h1>
        </div>
        <button className="secondary-button compact" type="button" onClick={refreshProjectsAndHistory} disabled={loading}>
          Refresh
        </button>
      </header>

      {error ? <div className="error-banner global-error">{error}</div> : null}

      <div className="dashboard-grid">
        <ProjectList projects={projects} selectedProjectId={selectedProjectId} onSelect={handleProjectSelect} />
        <SessionList
          project={selectedProject}
          sessions={sessions}
          history={filteredHistory}
          loading={loading}
          selectedSessionId={selectedSession?.id ?? null}
          onNew={() => startSession('new')}
          onContinue={() => startSession('continue')}
          onResume={handleResume}
          onOpen={setSelectedSession}
        />
        <ChatView session={selectedSession} onStatusChange={handleStatusChange} />
      </div>
    </main>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}
