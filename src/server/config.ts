import { homedir } from 'node:os';
import { resolve } from 'node:path';

export type AppConfig = {
  host: string;
  port: number;
  appToken: string;
  databasePath: string;
  claudeConfigDir: string;
  claudeBin: string;
  sessionTtlMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appToken = env.APP_TOKEN?.trim();
  if (!appToken) {
    throw new Error('APP_TOKEN is required');
  }

  const port = Number(env.PORT ?? '8787');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const sessionTtlMs = Number(env.SESSION_TTL_MS ?? '1800000');
  if (!Number.isInteger(sessionTtlMs) || sessionTtlMs < 60000) {
    throw new Error('SESSION_TTL_MS must be at least 60000');
  }

  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port,
    appToken,
    databasePath: env.DATABASE_PATH?.trim() || './webagent.db',
    claudeConfigDir: env.CLAUDE_CONFIG_DIR?.trim() || resolve(homedir(), '.claude'),
    claudeBin: env.CLAUDE_BIN?.trim() || 'claude',
    sessionTtlMs,
  };
}
