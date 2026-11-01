import { useState } from 'react';
import { api, ApiError, setTokens } from '../api';
export default function AuthPage({ onAuth }) {
    const [mode, setMode] = useState('register');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    async function submit(e) {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            const d = await api(`/auth/${mode}`, {
                method: 'POST',
                body: { email, password },
                auth: false,
            });
            setTokens({ accessToken: d.accessToken, refreshToken: d.refreshToken });
            onAuth(d.user);
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : 'Cannot reach the server');
        }
        finally {
            setBusy(false);
        }
    }
    return (<div className="auth-wrap">
      <div className="auth-card">
        <div className="brand big">
          <span className="logo">▲</span> TradeSim
        </div>
        <p className="muted">
          A paper-trading exchange with a real matching engine. Start with <b>₹10,00,000</b> of play money.
        </p>
        <div className="tabs">
          <button className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')} type="button">
            Create account
          </button>
          <button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')} type="button">
            Log in
          </button>
        </div>
        <form onSubmit={submit}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email"/>
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/>
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy}>
            {busy ? '…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>);
}
