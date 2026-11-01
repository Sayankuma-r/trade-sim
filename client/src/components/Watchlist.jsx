import { pct, price, tone } from '../format';
export default function Watchlist({ tickers, selected, onSelect }) {
    return (<section className="panel watchlist">
      <h3>Markets</h3>
      <div className="wl-rows">
        {tickers.map((t) => (<button key={t.symbol} className={`wl-row ${t.symbol === selected ? 'sel' : ''}`} onClick={() => onSelect(t.symbol)}>
            <div>
              <div className="sym">
                {t.symbol} {t.halted && <span className="badge down">HALT</span>}
              </div>
              <div className="muted small">{t.sector}</div>
            </div>
            <div className="right">
              <div className="mono">{price(t.last)}</div>
              <div className={`mono small ${tone(t.changePct)}`}>{pct(t.changePct)}</div>
            </div>
          </button>))}
      </div>
    </section>);
}
