import { createDatabase } from './db';
import { loadConfig } from './config';
import { createApp } from './app';
import { ProjectRegistry } from './services/projectRegistry';
import { SessionRegistry } from './services/sessionRegistry';
import { StreamJsonClaudeEventSource } from './services/claudeEventSource';
import { RealtimeHub } from './services/realtimeHub';
import { ClaudeResumeIndex } from './services/claudeResumeIndex';

const config = loadConfig();
const db = createDatabase(config.databasePath);
const projects = new ProjectRegistry(db);
const sessions = new SessionRegistry(db);
sessions.stopRunningSessions();
const runner = new StreamJsonClaudeEventSource({ claudeBin: config.claudeBin });
const hub = new RealtimeHub(sessions, runner);
const resumeIndex = new ClaudeResumeIndex(config.claudeConfigDir);

const app = await createApp({ config, projects, sessions, runner, hub, resumeIndex });
await app.listen({ host: config.host, port: config.port });
