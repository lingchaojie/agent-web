import { createDatabase } from './db';
import { loadConfig } from './config';
import { createApp } from './app';
import { ProjectRegistry } from './services/projectRegistry';
import { SessionRegistry } from './services/sessionRegistry';
import { PtyRunner } from './services/ptyRunner';
import { RealtimeHub } from './services/realtimeHub';

const config = loadConfig();
const db = createDatabase(config.databasePath);
const projects = new ProjectRegistry(db);
const sessions = new SessionRegistry(db);
const runner = new PtyRunner({ claudeBin: config.claudeBin });
const hub = new RealtimeHub(sessions, runner);

const app = await createApp({ config, projects, sessions, runner, hub });
await app.listen({ host: config.host, port: config.port });
