import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { price } from '../format';
export default function PriceChart({ symbol, trades }) {
    const data = trades.map((t, i) => ({ i, p: t.price / 100 }));
    const first = data[0]?.p ?? 0;
    const last = data[data.length - 1]?.p ?? 0;
    const up = last >= first;
    const color = up ? '#22c55e' : '#ef4444';
    return (<section className="panel chart">
      <div className="chart-head">
        <h3>{symbol}</h3>
        <div className="mono big-price" style={{ color }}>
          {last ? '₹' + price(Math.round(last * 100)) : '—'}
        </div>
        <span className="muted small">last {data.length} trades</span>
      </div>
      <div className="chart-body">
        {data.length < 2 ? (<div className="empty">Waiting for trades…</div>) : (<ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35}/>
                  <stop offset="100%" stopColor={color} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1f2937" vertical={false}/>
              <XAxis dataKey="i" hide/>
              <YAxis domain={['auto', 'auto']} width={64} tick={{ fill: '#8b97a8', fontSize: 11 }} tickFormatter={(v) => v.toFixed(2)} stroke="#1f2937"/>
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #243044', borderRadius: 8, fontSize: 12 }} labelFormatter={() => ''} formatter={(v) => ['₹' + Number(v).toFixed(2), 'Price']}/>
              <Area type="stepAfter" dataKey="p" stroke={color} strokeWidth={2} fill="url(#g)" isAnimationActive={false} dot={false}/>
            </AreaChart>
          </ResponsiveContainer>)}
      </div>
    </section>);
}
