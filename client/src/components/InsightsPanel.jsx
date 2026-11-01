import { useState } from 'react';
import { api, ApiError } from '../api';
export default function InsightsPanel({ portfolio }) {
    const [res, setRes] = useState(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    async function run() {
        setBusy(true);
        setErr('');
        try {
            setRes(await api('/portfolio/explain', { method: 'POST', body: {} }));
        }
        catch (e) {
            setErr(e instanceof ApiError && e.status === 429 ? 'Slow down: 5 explanations per minute.' : 'Could not generate an explanation.');
        }
        finally {
            setBusy(false);
        }
    }
    const c = portfolio?.concentration;
    return (<div className="insights">
      <div className="metrics">
        <div className="metric">
          <span className="muted small">Risk level</span>
          <span className={`badge risk-${portfolio?.riskLevel ?? 'none'}`}>{portfolio?.riskLevel ?? '—'}</span>
        </div>
        <div className="metric">
          <span className="muted small">Top position</span>
          <b className="mono">{c ? c.topPositionPct.toFixed(1) : '—'}%</b>
        </div>
        <div className="metric">
          <span className="muted small">Top sector</span>
          <b className="mono">{c ? c.topSectorPct.toFixed(1) : '—'}%</b>
        </div>
        <div className="metric">
          <span className="muted small">Concentration (HHI)</span>
          <b className="mono">{c ? c.hhi.toFixed(2) : '—'}</b>
        </div>
        <div className="metric">
          <span className="muted small">Est. volatility</span>
          <b className="mono">{portfolio ? portfolio.estimatedVolatilityPct.toFixed(2) : '—'}%</b>
        </div>
      </div>
      <div className="explain">
        <button className="primary" onClick={run} disabled={busy || !portfolio}>
          {busy ? 'Thinking…' : '✨ Explain my portfolio'}
        </button>
        {err && <div className="error">{err}</div>}
        {res && (<div className="explain-text">
            <p>{res.text}</p>
            <div className="muted small">
              {res.source === 'llm' ? 'Written by an LLM' : 'Template explanation (set ANTHROPIC_API_KEY for the LLM version)'} · numbers computed by the server, not
              the model{res.cached ? ' · cached' : ''}
            </div>
          </div>)}
        {!res && <p className="muted">All the maths (P&amp;L, weights, concentration, volatility) is computed deterministically on the server. The LLM only turns those numbers into plain English.</p>}
      </div>
    </div>);
}
