import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
export default function AdminPanel({ tickers }) {
    const [inv, setInv] = useState(null);
    const [stats, setStats] = useState(null);
    const load = useCallback(async () => {
        const [i, s] = await Promise.all([api('/admin/invariants'), api('/admin/stats')]);
        setInv(i);
        setStats(s);
    }, []);
    useEffect(() => {
        load().catch(() => undefined);
    }, [load]);
    const toggle = async (t) => {
        await api(`/admin/symbols/${t.symbol}/${t.halted ? 'resume' : 'halt'}`, { method: 'POST', body: {} });
    };
    return (<div className="admin">
      <div className="metrics">
        {stats && (<>
            <div className="metric"><span className="muted small">Users</span><b className="mono">{stats.users}</b></div>
            <div className="metric"><span className="muted small">Orders</span><b className="mono">{stats.orders}</b></div>
            <div className="metric"><span className="muted small">Trades</span><b className="mono">{stats.trades}</b></div>
            <div className="metric"><span className="muted small">Open orders</span><b className="mono">{stats.openOrders}</b></div>
          </>)}
        <div className="metric">
          <span className="muted small">Conservation of money &amp; shares</span>
          <span className={`badge ${inv?.ok ? 'filled' : 'rejected'}`}>{inv ? (inv.ok ? 'all invariants hold' : 'VIOLATION') : '…'}</span>
        </div>
        <button className="link" onClick={() => load()}>Re-check</button>
      </div>
      <div className="halts">
        {tickers.map((t) => (<button key={t.symbol} className={`chip ${t.halted ? 'halted' : ''}`} onClick={() => toggle(t).then(() => load())}>
            {t.symbol}: {t.halted ? 'Resume' : 'Halt'}
          </button>))}
      </div>
    </div>);
}
