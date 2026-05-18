import { FormEvent, useState } from 'react';
import { checkAuth, setToken } from '../api';

type LoginViewProps = {
  onAuthenticated(): void;
};

export default function LoginView({ onAuthenticated }: LoginViewProps) {
  const [tokenValue, setTokenValue] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setChecking(true);
    setToken(tokenValue);

    const authenticated = await checkAuth();
    setChecking(false);

    if (authenticated) {
      onAuthenticated();
    } else {
      setError('That token was not accepted. Check WEBAGENT_TOKEN and try again.');
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card panel">
        <div className="brand-mark">CC</div>
        <p className="eyebrow">Mobile command deck</p>
        <h1>Claude Mobile Controller</h1>
        <p className="muted">
          Connect to your local WebAgent server, pick a project, and steer Claude Code sessions from your phone.
        </p>
        <form onSubmit={handleSubmit} className="login-form">
          <label htmlFor="token">Access token</label>
          <input
            id="token"
            autoComplete="current-password"
            inputMode="text"
            required
            type="password"
            value={tokenValue}
            onChange={(event) => setTokenValue(event.target.value)}
            placeholder="Paste WEBAGENT_TOKEN"
          />
          {error ? <p className="error-text">{error}</p> : null}
          <button className="primary-button" type="submit" disabled={checking}>
            {checking ? 'Checking...' : 'Unlock controller'}
          </button>
        </form>
      </section>
    </main>
  );
}
