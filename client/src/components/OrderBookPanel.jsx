import { int, price } from '../format';
function Rows({ levels, side, max, onPick }) {
    return (<>
      {levels.map((l) => (<button key={l.price} className={`ob-row ${side}`} onClick={() => onPick(l.price)} title="Click to use this price">
          <span className="bar" style={{ width: `${Math.min(100, (l.quantity / max) * 100)}%` }}/>
          <span className="mono p">{price(l.price)}</span>
          <span className="mono q">{int(l.quantity)}</span>
        </button>))}
    </>);
}
export default function OrderBookPanel({ book, onPick }) {
    const asks = (book?.asks ?? []).slice(0, 8);
    const bids = (book?.bids ?? []).slice(0, 8);
    const max = Math.max(1, ...asks.map((l) => l.quantity), ...bids.map((l) => l.quantity));
    const spread = asks[0] && bids[0] ? asks[0].price - bids[0].price : null;
    return (<section className="panel orderbook">
      <h3>Order book</h3>
      <div className="ob-head">
        <span>Price (₹)</span>
        <span>Qty</span>
      </div>
      <div className="ob-side">
        <Rows levels={[...asks].reverse()} side="ask" max={max} onPick={onPick}/>
      </div>
      <div className="ob-spread mono">{spread == null ? '—' : `Spread ₹${price(spread)}`}</div>
      <div className="ob-side">
        <Rows levels={bids} side="bid" max={max} onPick={onPick}/>
      </div>
      {!book && <div className="empty">Loading…</div>}
    </section>);
}
