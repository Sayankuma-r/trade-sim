import crypto from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import { OrderBook } from '../engine/orderBook.js';
import { Account, Order, Position, Trade } from '../models/index.js';
import { ApiError } from '../errors.js';
import { SYMBOLS, SYMBOL_MAP } from '../symbols.js';
import { config } from '../config.js';
import { bus } from './bus.js';
export function toOrderDTO(o) {
    return {
        id: String(o._id),
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        price: o.price ?? null,
        quantity: o.quantity,
        filledQty: o.filledQty,
        avgFillPrice: o.filledQty > 0 ? Math.round(o.filledValue / o.filledQty) : null,
        status: o.status,
        clientOrderId: o.clientOrderId,
        createdAt: (o.createdAt ?? new Date()).toISOString(),
    };
}
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
export class Exchange {
    books = new Map();
    halted = new Set();
    lastPrice = new Map();
    openPrice = new Map();
    /** Recent trade prices per symbol (for volatility). Oldest -> newest. */
    history = new Map();
    tails = new Map();
    dirty = new Set();
    timers = [];
    /* ------------------------------------------------------------------ *
     * Startup / book rebuild
     * ------------------------------------------------------------------ */
    async init() {
        for (const s of SYMBOLS) {
            await this.loadBook(s.symbol);
            const recent = await Trade.find({ symbol: s.symbol }).sort({ createdAt: -1 }).limit(300).lean();
            const prices = recent.map((t) => t.price).reverse();
            this.history.set(s.symbol, prices);
            this.lastPrice.set(s.symbol, prices.length ? prices[prices.length - 1] : s.refPrice);
            const since = new Date(Date.now() - 24 * 3600 * 1000);
            const first = await Trade.findOne({ symbol: s.symbol, createdAt: { $gte: since } })
                .sort({ createdAt: 1 })
                .lean();
            this.openPrice.set(s.symbol, first?.price ?? this.lastPrice.get(s.symbol));
        }
    }
    /** Rebuild one symbol's book from OPEN orders in MongoDB (the source of truth). */
    async loadBook(symbol) {
        const book = new OrderBook(symbol);
        const open = await Order.find({ symbol, type: 'limit', status: { $in: ['open', 'partial'] } })
            .sort({ _id: 1 }) // ObjectId order == arrival order → preserves time priority
            .lean();
        for (const o of open) {
            book.rest({
                id: String(o._id),
                userId: String(o.userId),
                side: o.side,
                price: o.price,
                remaining: o.quantity - o.filledQty,
            });
        }
        this.books.set(symbol, book);
    }
    startBroadcasting() {
        this.timers.push(setInterval(() => {
            for (const symbol of this.dirty) {
                bus.publish(`symbol:${symbol}`, 'book', this.books.get(symbol).snapshot(12));
            }
            this.dirty.clear();
        }, 100), setInterval(() => bus.publish('ticker', 'ticker', this.getTicker()), 1000));
    }
    stop() {
        this.timers.forEach(clearInterval);
        this.timers = [];
    }
    /* ------------------------------------------------------------------ *
     * Per-symbol serialization
     *
     * All state changes for one symbol run ONE AT A TIME through this queue.
     * Node is single-threaded, so this makes the book + the symbol's positions
     * free of races without any locking primitives. To scale out, shard
     * symbols across processes (each symbol owned by exactly one engine).
     * ------------------------------------------------------------------ */
    exclusive(symbol, fn) {
        const prev = this.tails.get(symbol) ?? Promise.resolve();
        const run = prev.then(fn);
        this.tails.set(symbol, run.catch(() => undefined));
        return run;
    }
    /**
     * Run `fn` in a MongoDB transaction (all-or-nothing). If anything fails after the
     * in-memory book was touched, the book is rebuilt from the database so memory never
     * diverges from what was committed. Transient errors (e.g. write conflicts) retry.
     */
    async inTx(symbol, fn) {
        for (let attempt = 1;; attempt++) {
            const ctx = { touched: false, after: [] };
            const session = config.MONGO_TRANSACTIONS ? await mongoose.startSession() : undefined;
            try {
                session?.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
                const out = await fn(session, ctx);
                if (session)
                    await session.commitTransaction();
                for (const f of ctx.after)
                    f();
                return out;
            }
            catch (err) {
                if (session?.inTransaction())
                    await session.abortTransaction().catch(() => undefined);
                if (ctx.touched)
                    await this.loadBook(symbol);
                const transient = err.hasErrorLabel?.('TransientTransactionError');
                if (transient && attempt < 3)
                    continue;
                throw err;
            }
            finally {
                await session?.endSession();
            }
        }
    }
    /* ------------------------------------------------------------------ *
     * Place order
     * ------------------------------------------------------------------ */
    async placeOrder(userId, input) {
        const { symbol, side, type, quantity } = input;
        if (!SYMBOL_MAP.has(symbol))
            throw new ApiError(404, 'UNKNOWN_SYMBOL', `Unknown symbol ${symbol}`);
        if (this.halted.has(symbol))
            throw new ApiError(409, 'MARKET_HALTED', `${symbol} is halted`);
        if (type === 'limit' && !input.price)
            throw new ApiError(400, 'PRICE_REQUIRED', 'Limit orders need a price');
        const clientOrderId = input.clientOrderId ?? crypto.randomUUID();
        const requestHash = hash(`${symbol}|${side}|${type}|${input.price ?? ''}|${quantity}`);
        const uid = new Types.ObjectId(userId);
        const replay = async () => {
            const existing = await Order.findOne({ userId: uid, clientOrderId }).lean();
            if (!existing)
                return null;
            if (existing.requestHash !== requestHash) {
                throw new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used with a different request');
            }
            return { order: toOrderDTO(existing), replay: true };
        };
        const early = await replay();
        if (early)
            return early;
        return this.exclusive(symbol, async () => {
            // Re-check inside the queue: a duplicate that was queued behind the original lands here.
            const again = await replay();
            if (again)
                return again;
            try {
                const order = await this.inTx(symbol, (session, ctx) => this.execute(session, ctx, uid, input, clientOrderId, requestHash));
                return { order, replay: false };
            }
            catch (e) {
                // The unique index (userId, clientOrderId) is the last line of defence against duplicates.
                if (e.code === 11000) {
                    const r = await replay();
                    if (r)
                        return r;
                }
                throw e;
            }
        });
    }
    async execute(session, ctx, uid, input, clientOrderId, requestHash) {
        const { symbol, side, type, quantity } = input;
        const userId = String(uid);
        const book = this.books.get(symbol);
        const oid = new Types.ObjectId();
        const orderId = oid.toHexString();
        const isBuy = side === 'buy';
        // 1) Create the order doc FIRST: if this is a duplicate the unique index throws
        //    before any money moves.
        await Order.create([
            {
                _id: oid,
                userId: uid,
                symbol,
                side,
                type,
                price: type === 'limit' ? input.price : undefined,
                quantity,
                status: 'open',
                reservedCash: 0,
                clientOrderId,
                requestHash,
            },
        ], { session });
        // 2) Reserve funds / shares with ONE guarded atomic update.
        //    Mongo applies a single-document update atomically, so two concurrent orders can
        //    never both pass the `$gte` guard and spend the same money.
        let reserve = 0;
        try {
            if (isBuy) {
                if (type === 'limit') {
                    reserve = input.price * quantity;
                }
                else {
                    const est = book.estimateBuyCost(quantity, userId);
                    if (est.fillable === 0)
                        throw new ApiError(422, 'NO_LIQUIDITY', 'No sellers available for a market buy');
                    reserve = est.cost;
                }
                const r = await Account.updateOne({ userId: uid, available: { $gte: reserve } }, { $inc: { available: -reserve, locked: reserve } }, { session });
                if (r.modifiedCount !== 1)
                    throw new ApiError(402, 'INSUFFICIENT_FUNDS', 'Not enough available cash');
            }
            else {
                const r = await Position.updateOne({ userId: uid, symbol, quantity: { $gte: quantity } }, { $inc: { quantity: -quantity, lockedQuantity: quantity } }, { session });
                if (r.modifiedCount !== 1)
                    throw new ApiError(422, 'INSUFFICIENT_SHARES', 'Not enough shares (short selling is not allowed)');
            }
        }
        catch (e) {
            if (!session)
                await Order.deleteOne({ _id: oid }); // no transaction to roll the doc back for us
            throw e;
        }
        // 3) Match in memory.
        ctx.touched = true;
        const res = book.submit({ id: orderId, userId, side, type, price: input.price, quantity });
        // 4) Accumulate every change as deltas, then write them once.
        const acct = new Map();
        const A = (u) => acct.get(u) ?? acct.set(u, { avail: 0, locked: 0 }).get(u);
        const pos = new Map();
        const P = (u) => pos.get(u) ?? pos.set(u, { dQty: 0, dLocked: 0, dCost: 0, dRealized: 0 }).get(u);
        const ord = new Map();
        const O = (id) => ord.get(id) ?? ord.set(id, { dFilled: 0, dValue: 0, dReserved: 0 }).get(id);
        // 4a) self-trade prevention: release the cancelled resting orders' reservations
        for (const c of res.stpCancelled) {
            if (c.side === 'buy') {
                const cash = c.price * c.remaining;
                A(c.userId).locked -= cash;
                A(c.userId).avail += cash;
            }
            else {
                P(c.userId).dLocked -= c.remaining;
                P(c.userId).dQty += c.remaining;
            }
        }
        // 4b) cost-basis bookkeeping needs current positions of the sellers involved
        const sellerIds = [...new Set(res.fills.map((f) => f.sellerId))];
        const sellerState = new Map();
        if (sellerIds.length) {
            const docs = await Position.find({ userId: { $in: sellerIds.map((s) => new Types.ObjectId(s)) }, symbol }, null, { session }).lean();
            for (const d of docs)
                sellerState.set(String(d.userId), { quantity: d.quantity, locked: d.lockedQuantity, costBasis: d.costBasis });
        }
        const tradeDocs = [];
        for (const f of res.fills) {
            const p = f.price;
            const q = f.quantity;
            tradeDocs.push({
                symbol,
                price: p,
                quantity: q,
                buyOrderId: new Types.ObjectId(f.buyOrderId),
                sellOrderId: new Types.ObjectId(f.sellOrderId),
                buyerId: new Types.ObjectId(f.buyerId),
                sellerId: new Types.ObjectId(f.sellerId),
            });
            // seller: receives cash, delivers locked shares, realises P&L
            A(f.sellerId).avail += p * q;
            const st = sellerState.get(f.sellerId);
            const total = st.quantity + st.locked;
            const removed = q >= total ? st.costBasis : Math.round((st.costBasis / total) * q);
            st.locked -= q;
            st.costBasis -= removed;
            P(f.sellerId).dLocked -= q;
            P(f.sellerId).dCost -= removed;
            P(f.sellerId).dRealized += p * q - removed;
            // buyer: pays `perUnit` from the lock (limit price for a limit taker, else the fill
            // price) and gets any price improvement refunded straight away.
            const buyerIsTakerLimit = f.buyOrderId === orderId && type === 'limit';
            const perUnit = buyerIsTakerLimit ? input.price : p;
            A(f.buyerId).locked -= perUnit * q;
            A(f.buyerId).avail += (perUnit - p) * q;
            P(f.buyerId).dQty += q;
            P(f.buyerId).dCost += p * q;
            O(f.buyOrderId).dReserved -= perUnit * q;
            for (const id of [f.buyOrderId, f.sellOrderId]) {
                O(id).dFilled += q;
                O(id).dValue += p * q;
            }
            if (f.makerOrderId !== orderId)
                O(f.makerOrderId).status = f.makerRemaining === 0 ? 'filled' : 'partial';
        }
        // 4c) finalise the incoming (taker) order
        let status;
        let finalReserved = 0;
        const t = O(orderId);
        if (res.remaining === 0) {
            status = 'filled';
        }
        else if (type === 'limit') {
            status = res.filled > 0 ? 'partial' : 'open';
        }
        else {
            // market order that ran out of liquidity: cancel the remainder and release its reservation
            status = res.filled > 0 ? 'cancelled' : 'rejected';
            if (isBuy) {
                const leftover = reserve + t.dReserved;
                A(userId).locked -= leftover;
                A(userId).avail += leftover;
                t.dReserved -= leftover;
            }
            else {
                P(userId).dLocked -= res.remaining;
                P(userId).dQty += res.remaining;
            }
        }
        if (isBuy)
            finalReserved = reserve + t.dReserved;
        // 5) Write everything (inside the same transaction when enabled).
        await Order.updateOne({ _id: oid }, { $set: { status, filledQty: res.filled, filledValue: t.dValue, reservedCash: finalReserved } }, { session });
        for (const [id, d] of ord) {
            if (id === orderId)
                continue;
            await Order.updateOne({ _id: new Types.ObjectId(id) }, { $inc: { filledQty: d.dFilled, filledValue: d.dValue, reservedCash: d.dReserved }, ...(d.status ? { $set: { status: d.status } } : {}) }, { session });
        }
        for (const c of res.stpCancelled) {
            await Order.updateOne({ _id: new Types.ObjectId(c.id) }, { $set: { status: 'cancelled', reservedCash: 0 } }, { session });
        }
        for (const [u, d] of acct) {
            if (!d.avail && !d.locked)
                continue;
            await Account.updateOne({ userId: new Types.ObjectId(u) }, { $inc: { available: d.avail, locked: d.locked } }, { session });
        }
        for (const [u, d] of pos) {
            await Position.updateOne({ userId: new Types.ObjectId(u), symbol }, {
                $inc: { quantity: d.dQty, lockedQuantity: d.dLocked, costBasis: d.dCost, realizedPnl: d.dRealized },
                $setOnInsert: { seeded: 0 },
            }, { session, upsert: true });
        }
        if (tradeDocs.length)
            await Trade.insertMany(tradeDocs, { session });
        // 6) Success path: once the caller commits, notify. (Events are queued on the next tick,
        //    after commit, because inTx commits right after this function returns.)
        const dto = toOrderDTO({
            _id: oid,
            symbol,
            side,
            type,
            price: input.price ?? null,
            quantity,
            filledQty: res.filled,
            filledValue: t.dValue,
            status,
            clientOrderId,
            createdAt: new Date(),
        });
        const affectedUsers = new Set([...acct.keys(), ...pos.keys(), userId]);
        ctx.after.push(() => this.publishAfterCommit(symbol, res.fills, affectedUsers));
        return dto;
    }
    publishAfterCommit(symbol, fills, users) {
        const now = Date.now();
        for (const f of fills) {
            this.lastPrice.set(symbol, f.price);
            const h = this.history.get(symbol) ?? [];
            h.push(f.price);
            if (h.length > 300)
                h.shift();
            this.history.set(symbol, h);
            bus.publish(`symbol:${symbol}`, 'trade', { symbol, price: f.price, quantity: f.quantity, ts: now });
        }
        this.dirty.add(symbol);
        // Tell every user whose orders/cash/shares changed to refetch (they own the truth in REST).
        for (const u of users)
            bus.publish(`user:${u}`, 'refresh', { symbol });
    }
    /* ------------------------------------------------------------------ *
     * Cancel order
     * ------------------------------------------------------------------ */
    async cancelOrder(userId, orderId) {
        if (!Types.ObjectId.isValid(orderId))
            throw new ApiError(400, 'BAD_ID', 'Invalid order id');
        const uid = new Types.ObjectId(userId);
        const oid = new Types.ObjectId(orderId);
        const found = await Order.findOne({ _id: oid, userId: uid }).lean();
        if (!found)
            throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found');
        const symbol = found.symbol;
        const dto = await this.exclusive(symbol, () => this.inTx(symbol, async (session, ctx) => {
            // Atomically flip open/partial -> cancelled. If someone else already did (or it
            // filled in the meantime), this returns null and we stop: no double refunds.
            const doc = await Order.findOneAndUpdate({ _id: oid, userId: uid, status: { $in: ['open', 'partial'] } }, { $set: { status: 'cancelled', reservedCash: 0 } }, { session, returnDocument: 'before' });
            if (!doc)
                throw new ApiError(409, 'NOT_CANCELLABLE', 'Order is already filled or cancelled');
            ctx.touched = true;
            this.books.get(symbol).cancel(orderId);
            const remaining = doc.quantity - doc.filledQty;
            if (doc.side === 'buy') {
                await Account.updateOne({ userId: uid }, { $inc: { available: doc.reservedCash, locked: -doc.reservedCash } }, { session });
            }
            else {
                await Position.updateOne({ userId: uid, symbol }, { $inc: { quantity: remaining, lockedQuantity: -remaining } }, { session });
            }
            ctx.after.push(() => {
                this.dirty.add(symbol);
                bus.publish(`user:${userId}`, 'refresh', { symbol });
            });
            return toOrderDTO({ ...doc.toObject(), status: 'cancelled' });
        }));
        return dto;
    }
    /* ------------------------------------------------------------------ *
     * Read helpers
     * ------------------------------------------------------------------ */
    getBook(symbol, depth = 10) {
        const b = this.books.get(symbol);
        if (!b)
            throw new ApiError(404, 'UNKNOWN_SYMBOL', `Unknown symbol ${symbol}`);
        return b.snapshot(depth);
    }
    getTicker() {
        return SYMBOLS.map((s) => {
            const last = this.lastPrice.get(s.symbol) ?? s.refPrice;
            const open = this.openPrice.get(s.symbol) ?? last;
            const book = this.books.get(s.symbol);
            return {
                symbol: s.symbol,
                name: s.name,
                sector: s.sector,
                last,
                changePct: open ? Math.round(((last - open) / open) * 10000) / 100 : 0,
                bestBid: book?.bestBid() ?? null,
                bestAsk: book?.bestAsk() ?? null,
                halted: this.halted.has(s.symbol),
            };
        });
    }
    /** Conservation checks: money and shares are never created or destroyed. */
    async checkInvariants() {
        // one aggregation per sum: simple, and portable across Mongo-compatible servers
        const sum = async (model, match, field) => (await model.aggregate([{ $match: match }, { $group: { _id: null, t: { $sum: `$${field}` } } }]))[0]?.t ?? 0;
        const cash = {
            available: await sum(Account, {}, 'available'),
            locked: await sum(Account, {}, 'locked'),
            initial: await sum(Account, {}, 'initial'),
        };
        const reservedByOrders = await sum(Order, { side: 'buy', status: { $in: ['open', 'partial'] } }, 'reservedCash');
        const negatives = await Account.countDocuments({ $or: [{ available: { $lt: 0 } }, { locked: { $lt: 0 } }] });
        const negativePositions = await Position.countDocuments({ $or: [{ quantity: { $lt: 0 } }, { lockedQuantity: { $lt: 0 } }] });
        const shares = [];
        for (const s of SYMBOLS) {
            const free = await sum(Position, { symbol: s.symbol }, 'quantity');
            const locked = await sum(Position, { symbol: s.symbol }, 'lockedQuantity');
            const seeded = await sum(Position, { symbol: s.symbol }, 'seeded');
            const openSells = await Order.find({ symbol: s.symbol, side: 'sell', status: { $in: ['open', 'partial'] } }, 'quantity filledQty').lean();
            const sellRemaining = openSells.reduce((a, o) => a + (o.quantity - o.filledQty), 0);
            shares.push({
                symbol: s.symbol,
                total: free + locked,
                seeded,
                lockedShares: locked,
                openSellRemaining: sellRemaining,
                ok: free + locked === seeded && locked === sellRemaining,
            });
        }
        const cashOk = cash.available + cash.locked === cash.initial && cash.locked === reservedByOrders && negatives === 0 && negativePositions === 0;
        return {
            ok: cashOk && shares.every((x) => x.ok),
            cash: { ...cash, reservedByOpenBuyOrders: reservedByOrders, negativeAccounts: negatives, negativePositions, ok: cashOk },
            shares,
        };
    }
}
