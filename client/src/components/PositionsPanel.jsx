import { int, money, pct, price, signed, tone } from '../format';
export default function PositionsPanel({ portfolio }) {
    if (!portfolio)
        return <div className="empty">Loading…</div>;
    return (<div className="positions">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Sector</th>
              <th className="r">Qty</th>
              <th className="r">Avg price</th>
              <th className="r">Last</th>
              <th className="r">Value</th>
              <th className="r">Unrealised P&amp;L</th>
              <th className="r">Weight</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.holdings.map((h) => (<tr key={h.symbol}>
                <td>{h.symbol}</td>
                <td className="muted">{h.sector}</td>
                <td className="r mono">{int(h.quantity)}</td>
                <td className="r mono">{price(h.avgPrice)}</td>
                <td className="r mono">{price(h.lastPrice)}</td>
                <td className="r mono">{money(h.marketValue)}</td>
                <td className={`r mono ${tone(h.unrealizedPnl)}`}>
                  {signed(h.unrealizedPnl)} <span className="small">({pct(h.unrealizedPnlPct)})</span>
                </td>
                <td className="r mono">{h.weightPct.toFixed(1)}%</td>
              </tr>))}
            {!portfolio.holdings.length && (<tr>
                <td colSpan={8} className="empty">
                  No positions yet. Buy something!
                </td>
              </tr>)}
          </tbody>
        </table>
      </div>
      {portfolio.sectors.length > 0 && (<div className="sectors">
          {portfolio.sectors.map((s) => (<div key={s.sector} className="sector-row">
              <span>{s.sector}</span>
              <div className="meter">
                <div style={{ width: `${s.weightPct}%` }}/>
              </div>
              <span className="mono">{s.weightPct.toFixed(1)}%</span>
            </div>))}
        </div>)}
    </div>);
}
