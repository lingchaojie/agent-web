import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config';
import { getBearerToken, isAuthorized } from '../../src/server/auth';

const baseEnv = {
  HOST: '100.64.0.10',
  PORT: '8787',
  APP_TOKEN: 'secret-token',
  DATABASE_PATH: ':memory:',
  CLAUDE_BIN: 'claude',
  SESSION_TTL_MS: '1800000',
};

describe('config', () => {
  it('loads safe defaults and explicit values', () => {
    const config = loadConfig(baseEnv);

    expect(config.host).toBe('100.64.0.10');
    expect(config.port).toBe(8787);
    expect(config.appToken).toBe('secret-token');
    expect(config.databasePath).toBe(':memory:');
    expect(config.claudeBin).toBe('claude');
    expect(config.sessionTtlMs).toBe(1800000);
  });

  it('rejects missing app token', () => {
    expect(() => loadConfig({ ...baseEnv, APP_TOKEN: '' })).toThrow('APP_TOKEN is required');
  });
});

describe('auth', () => {
  it('extracts bearer token', () => {
    expect(getBearerToken('Bearer secret-token')).toBe('secret-token');
    expect(getBearerToken('bearer secret-token')).toBe('secret-token');
  });

  it('rejects missing or malformed bearer token', () => {
    expect(getBearerToken(undefined)).toBeNull();
    expect(getBearerToken('Token secret-token')).toBeNull();
  });

  it('authorizes only exact token matches', () => {
    expect(isAuthorized('Bearer secret-token', 'secret-token')).toBe(true);
    expect(isAuthorized('Bearer wrong', 'secret-token')).toBe(false);
    expect(isAuthorized(undefined, 'secret-token')).toBe(false);
  });
});
