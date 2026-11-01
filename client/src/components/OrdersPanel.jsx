import { useState } from 'react';
import { api, ApiError } from '../api';
import { price } from '../format';
const time = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour12: false });
export default function OrdersPanel({ orders, onChange }) {
    const [tab, setTab] = useState('open');
    const [err, setErr] = useState('');
    const open = orders.filter((o) => o.status === 'open' || o.status === 'partial');
    const rows = tab === 'open' ? open : orders.filter((o) => o.status !== 'open' && o.status !== 'partial');
    async function cancel(id) {
        setErr('');
        try {
            await api(`/orders/${id}`, { method: 'DELETE' });
        }
        catch (e) {
            setErr(e instanceof ApiError ? e.message : 'Cancel failed');
        }
        onChange();
    }
    return (<div>
      <div className="subtabs">
        <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>
          Open ({open.length})
        </button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
          History
        </button>
        {err && <span className="error inline">{err}</span>}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Symbol</th>
              <th>Side</th>
              <th>Type</th>
              <th className="r">Price</th>
              <th className="r">Filled / Qty</th>
              <th className="r">Avg fill</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (<tr key={o.id}>
                <td className="mono muted">{time(o.createdAt)}</td>
                <td>{o.symbol}</td>
                <td className={o.side === 'buy' ? 'up' : 'down'}>{o.side.toUpperCase()}</td>
                <td>{o.type}</td>
                <td className="r mono">{price(o.price)}</td>
                <td className="r mono">
                  {o.filledQty} / {o.quantity}
                </td>
                <td className="r mono">{price(o.avgFillPrice)}</td>
                <td>
                  <span className={`badge ${o.status}`}>{o.status}</span>
                </td>
                <td className="r">
                  {(o.status === 'open' || o.status === 'partial') && (<button className="link" onClick={() => cancel(o.id)}>
                      Cancel
                    </button>)}
                </td>
              </tr>))}
            {!rows.length && (<tr>
                <td colSpan={9} className="empty">
                  {tab === 'open' ? 'No open orders. Place a limit order away from the market to see it rest on the book.' : 'No history yet.'}
                </td>
              </tr>)}
          </tbody>
        </table>
      </div>
    </div>);
}
