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
        <p className="eyebrow">移动控制台</p>
        <h1>Claude 移动控制台</h1>
        <p className="muted">
          连接本机 WebAgent 服务，在手机上选择项目并控制 Claude Code 会话。
        </p>
        <form onSubmit={handleSubmit} className="login-form">
          <label htmlFor="token">访问令牌</label>
          <input
            id="token"
            autoComplete="current-password"
            inputMode="text"
            required
            type="password"
            value={tokenValue}
            onChange={(event) => setTokenValue(event.target.value)}
            placeholder="粘贴 WEBAGENT_TOKEN"
          />
          {error ? <p className="error-text">{error}</p> : null}
          <button className="primary-button" type="submit" disabled={checking}>
            {checking ? '正在检查...' : '进入控制台'}
          </button>
        </form>
      </section>
    </main>
  );
}
