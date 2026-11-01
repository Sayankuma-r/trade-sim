import { useState } from 'react';
import { useAccount, useConnection, useSymbolFeed, useTickers } from './hooks';
import { money, pct, signed, tone } from './format';
import Watchlist from './components/Watchlist';
import PriceChart from './components/PriceChart';
import OrderBookPanel from './components/OrderBookPanel';
import OrderForm from './components/OrderForm';
import OrdersPanel from './components/OrdersPanel';
import PositionsPanel from './components/PositionsPanel';
import InsightsPanel from './components/InsightsPanel';
import AdminPanel from './components/AdminPanel';
export default function Trading({ user, socket, onLogout }) {
    const [symbol, setSymbol] = useState('RELIANCE');
    const [tab, setTab] = useState('orders');
    const [picked, setPicked] = useState(null);
    const connected = useConnection(socket);
    const tickers = useTickers(socket);
    const { book, trades } = useSymbolFeed(socket, symbol);
    const { portfolio, orders, reload } = useAccount(socket);
    const ticker = tickers.find((t) => t.symbol === symbol);
    const openCount = orders.filter((o) => o.status === 'open' || o.status === 'partial').length;
    return (<div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">▲</span> TradeSim
        </div>
        <div className="stats">
          <Stat label="Equity" value={money(portfolio?.equity)}/>
          <Stat label="Available cash" value={money(portfolio?.cash)}/>
          <Stat label="In open orders" value={money(portfolio?.lockedCash)}/>
          <Stat label="Total return" value={portfolio ? pct(portfolio.totalReturnPct) : '—'} cls={portfolio ? tone(portfolio.totalReturnPct) : ''} sub={portfolio ? signed(portfolio.equity - portfolio.startingEquity) : ''}/>
        </div>
        <div className="who">
          <span className={`dot ${connected ? 'on' : ''}`} title={connected ? 'Live' : 'Reconnecting…'}/>
          <span className="muted small">{user.email}</span>
          {user.role === 'admin' && <span className="badge open">admin</span>}
          <button className="link" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>

      <main className="grid">
        <Watchlist tickers={tickers} selected={symbol} onSelect={setSymbol}/>
        <PriceChart symbol={symbol} trades={trades}/>
        <div className="right-col">
          <OrderBookPanel book={book} onPick={setPicked}/>
          <OrderForm symbol={symbol} ticker={ticker} portfolio={portfolio} pickedPrice={picked} onDone={reload}/>
        </div>
        <section className="panel bottom">
          <div className="tabs">
            <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>
              Orders{openCount ? ` (${openCount})` : ''}
            </button>
            <button className={tab === 'positions' ? 'on' : ''} onClick={() => setTab('positions')}>
              Positions
            </button>
            <button className={tab === 'insights' ? 'on' : ''} onClick={() => setTab('insights')}>
              AI insights
            </button>
            {user.role === 'admin' && (<button className={tab === 'admin' ? 'on' : ''} onClick={() => setTab('admin')}>
                Admin
              </button>)}
          </div>
          {tab === 'orders' && <OrdersPanel orders={orders} onChange={reload}/>}
          {tab === 'positions' && <PositionsPanel portfolio={portfolio}/>}
          {tab === 'insights' && <InsightsPanel portfolio={portfolio}/>}
          {tab === 'admin' && <AdminPanel tickers={tickers}/>}
        </section>
      </main>
    </div>);
}
function Stat({ label, value, cls = '', sub }) {
    return (<div className="stat">
      <span className="muted small">{label}</span>
      <b className={`mono ${cls}`}>{value}</b>
      {sub ? <span className={`mono small ${cls}`}>{sub}</span> : null}
    </div>);
}
