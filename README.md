# TradeSim — paper-trading app (plain MERN)

MongoDB + Express + React + Node.js, all in JavaScript. Users trade six stocks with **market and limit orders** against a live **order book**. A **matching engine** pairs buyers and sellers (price-time priority), prices update live, and an **AI** feature explains your portfolio in plain English.

The big idea: **money can never be spent twice**, even when 100 orders arrive at the same moment.

## 1. Setup (about 5 minutes)

You need Node.js 18+ and a MongoDB database.

**Database — easiest is MongoDB Atlas (free):** create a free cluster at mongodb.com/atlas, make a database user, allow your IP, and copy the connection string. Atlas works with transactions out of the box.

```bash
# Terminal 1 — backend
cd server
cp .env.example .env        # then edit .env: paste MONGO_URI, set JWT_SECRET and ADMIN_PASSWORD
npm install
npm run dev                 # API on http://localhost:4000

# Terminal 2 — frontend
cd client
npm install
npm run dev                 # open http://localhost:5173
```

Register an account and you get ₹10,00,000 of paper money. Two bots (a market maker and a "noise" trader) keep the order book busy so there is always someone to trade with.

Using a plain local MongoDB (not Atlas)? Use `mongodb://127.0.0.1:27017/tradesim` and set `MONGO_TRANSACTIONS=false` in `.env`. (The code is then slightly less safe — good for learning, use Atlas for the real thing.)

**AI explanations:** add an `ANTHROPIC_API_KEY` to `.env` for real AI. Without it you get a built-in template explanation, so the feature always works.

## 2. Folder map

```
server/src
  index.js              starts everything (DB, bots, HTTP, WebSocket)
  app.js, routes/api.js all REST endpoints
  validate.js           checks request bodies by hand
  models/index.js       Mongoose schemas: User, Account, Position, Order, Trade
  engine/orderBook.js   THE MATCHING ENGINE (pure JS, no database) ← start reading here
  services/exchange.js  place/cancel orders + settlement in a DB transaction ← then here
  services/portfolio.js P&L, allocation, concentration, volatility
  services/ai.js        "Explain my portfolio"
  services/bots.js      market maker + noise trader
  ws/socket.js          Socket.io: live prices, book, fill notifications
client/src              React app (Trading.jsx, components/, hooks.js, api.js)
```

## 3. API

`POST /api/auth/register | login | refresh | logout` · `GET /api/auth/me`
`GET /api/market/symbols` · `/api/market/:symbol/book` · `/api/market/:symbol/trades`
`POST /api/orders` (header `Idempotency-Key`) · `GET /api/orders` · `DELETE /api/orders/:id`
`GET /api/portfolio` · `POST /api/portfolio/explain` · `GET /api/portfolio/trades`
Admin only: `GET /api/admin/stats`, `GET /api/admin/invariants`, `POST /api/admin/symbols/:symbol/halt|resume`

## 4. What you will learn (and how to explain it in interviews)

1. **Matching engine** — bids sorted high→low, asks low→high, ties broken by arrival time. A trade happens at the *resting* order's price. Partial fills leave the rest waiting in the book.
2. **No double-spending** — when you place a buy, your cash is reserved with ONE atomic update:
   `Account.updateOne({ userId, available: { $gte: cost } }, { $inc: { available: -cost, locked: cost } })`.
   If it modifies 0 documents, the order is rejected. Two simultaneous orders can't both pass the check. The wrong way is "read balance → check in JS → write", which has a race.
3. **MongoDB transactions** — one trade changes the order, both users' cash, both users' shares and the trade record. A transaction makes it all-or-nothing.
4. **Idempotency** — the client sends an `Idempotency-Key`. Double-click or network retry with the same key returns the original order instead of creating a second one (a unique index on `userId + clientOrderId` guarantees it).
5. **Per-symbol queue** — orders for one stock are processed one at a time, so the in-memory book never has race conditions.
6. **Crash recovery** — on restart the book is rebuilt from open orders in MongoDB.
7. **Money as integers** — all prices are in paise (₹1 = 100). Floats cause rounding bugs.
8. **AI used safely** — all maths is computed in code; the AI only *explains* the numbers (LLMs are bad at arithmetic).
9. **JWT auth** with access + refresh tokens, role-based admin routes, rate limiting.

## 5. Tests

```bash
cd server
npm test
```
`orderBook.test.js` tests the engine with no database. `exchange.test.js` and `api.test.js` start an in-memory MongoDB and test the hard parts: *100 simultaneous orders on a balance that only covers 10 → exactly 10 succeed*, the same idempotency key sent 20 times → 1 order, cancel-vs-fill races, crash recovery, and a random stress test checking money is conserved. (The first run downloads a MongoDB binary, so it needs internet.)

## 6. Ideas to extend it (great for interviews)

- Stop-loss orders · order history charts · leaderboard of best traders · watchlists
- Deploy: frontend on Vercel, backend on Render, database on Atlas
- Run a load test (e.g. with `autocannon`) and put your *measured* orders/sec on your resume

## Honest limitations

No fees, no short selling, only market/limit orders, prices come from bots (not a real market feed), and one server process owns each stock's book.
