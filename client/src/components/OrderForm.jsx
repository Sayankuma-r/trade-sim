import { useEffect, useMemo, useState } from 'react';
import { ApiError, placeOrder } from '../api';
import { TICK, money, price as fmtPrice, rupeesToPaise } from '../format';
const MESSAGES = {
    INSUFFICIENT_FUNDS: 'Not enough available cash for this order.',
    INSUFFICIENT_SHARES: 'You do not own enough shares (short selling is disabled).',
    NO_LIQUIDITY: 'No sellers right now, so a market buy cannot fill. Try a limit order.',
    MARKET_HALTED: 'Trading in this symbol is halted by an admin.',
    VALIDATION: 'Please check the price and quantity.',
};
export default function OrderForm({ symbol, ticker, portfolio, pickedPrice, onDone }) {
    const [side, setSide] = useState('buy');
    const [type, setType] = useState('limit');
    const [priceStr, setPriceStr] = useState('');
    const [qtyStr, setQtyStr] = useState('1');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);
    // default the price to the last traded price whenever the symbol changes
    useEffect(() => {
        if (ticker)
            setPriceStr(fmtPrice(ticker.last).replace(/,/g, ''));
        setMsg(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol]);
    useEffect(() => {
        if (pickedPrice) {
            setPriceStr(fmtPrice(pickedPrice).replace(/,/g, ''));
            setType('limit');
        }
    }, [pickedPrice]);
    const qty = /^\d+$/.test(qtyStr) ? Number(qtyStr) : 0;
    const limitPaise = rupeesToPaise(priceStr);
    const owned = portfolio?.holdings.find((h) => h.symbol === symbol)?.quantity ?? 0;
    const estimate = useMemo(() => {
        if (!qty)
            return null;
        if (type === 'limit')
            return limitPaise ? limitPaise * qty : null;
        const ref = side === 'buy' ? ticker?.bestAsk : ticker?.bestBid;
        return ref ? ref * qty : null;
    }, [qty, type, limitPaise, side, ticker]);
    const problem = !qty
        ? 'Enter a whole-number quantity.'
        : type === 'limit' && (!limitPaise || limitPaise % TICK !== 0)
            ? 'Price must be in ₹0.05 steps.'
            : '';
    async function submit(e) {
        e.preventDefault();
        if (problem || busy)
            return;
        setBusy(true);
        setMsg(null);
        try {
            const o = await placeOrder({ symbol, side, type, quantity: qty, ...(type === 'limit' ? { price: limitPaise } : {}) });
            const text = o.status === 'filled'
                ? `Filled ${o.filledQty} @ avg ₹${fmtPrice(o.avgFillPrice)}`
                : o.status === 'partial'
                    ? `Partly filled (${o.filledQty}/${o.quantity}); the rest is resting on the book`
                    : o.status === 'open'
                        ? 'Order placed and resting on the book'
                        : o.status === 'cancelled'
                            ? `Filled ${o.filledQty}; the rest was cancelled (not enough sellers/buyers)`
                            : 'Order rejected (no liquidity)';
            setMsg({ ok: o.status !== 'rejected', text });
            onDone();
        }
        catch (err) {
            setMsg({ ok: false, text: err instanceof ApiError ? (MESSAGES[err.code] ?? err.message) : 'Network error. Nothing was charged; safe to try again.' });
        }
        finally {
            setBusy(false);
        }
    }
    return (<section className="panel orderform">
      <h3>Trade {symbol}</h3>
      <div className="seg">
        <button type="button" className={side === 'buy' ? 'buy on' : 'buy'} onClick={() => setSide('buy')}>
          Buy
        </button>
        <button type="button" className={side === 'sell' ? 'sell on' : 'sell'} onClick={() => setSide('sell')}>
          Sell
        </button>
      </div>
      <div className="seg small">
        <button type="button" className={type === 'limit' ? 'on' : ''} onClick={() => setType('limit')}>
          Limit
        </button>
        <button type="button" className={type === 'market' ? 'on' : ''} onClick={() => setType('market')}>
          Market
        </button>
      </div>
      <form onSubmit={submit}>
        {type === 'limit' && (<label>
            Price (₹)
            <input className="mono" inputMode="decimal" value={priceStr} onChange={(e) => setPriceStr(e.target.value)}/>
          </label>)}
        <label>
          Quantity
          <input className="mono" inputMode="numeric" value={qtyStr} onChange={(e) => setQtyStr(e.target.value.replace(/\D/g, ''))}/>
        </label>
        <div className="kv">
          <span className="muted">{type === 'market' ? 'Est. (best price)' : 'Order value'}</span>
          <span className="mono">{estimate ? money(estimate) : '—'}</span>
        </div>
        <div className="kv">
          <span className="muted">{side === 'buy' ? 'Available cash' : 'Shares owned'}</span>
          <span className="mono">{side === 'buy' ? money(portfolio?.cash) : owned}</span>
        </div>
        {problem && <div className="hint">{problem}</div>}
        <button className={`primary ${side}`} disabled={busy || !!problem}>
          {busy ? 'Sending…' : `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol}`}
        </button>
        {msg && <div className={msg.ok ? 'success' : 'error'}>{msg.text}</div>}
      </form>
    </section>);
}
