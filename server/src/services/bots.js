import { Types } from 'mongoose';
import { Order } from '../models/index.js';
import { SYMBOLS, TICK } from '../symbols.js';
const snap = (p) => Math.max(TICK, Math.round(p / TICK) * TICK);
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
/**
 * Keeps the market alive so the demo never shows an empty book:
 *  - market maker: quotes 3 bid + 3 ask levels around a slowly random-walking mid price
 *  - noise taker:  sends small random market orders so trades keep printing
 * Both use the SAME public placeOrder/cancelOrder path as real users.
 */
export class Bots {
    exchange;
    mmId;
    takerId;
    timers = [];
    mid = new Map(SYMBOLS.map((s) => [s.symbol, s.refPrice]));
    busy = new Set();
    constructor(exchange, mmId, takerId) {
        this.exchange = exchange;
        this.mmId = mmId;
        this.takerId = takerId;
    }
    start() {
        SYMBOLS.forEach((s, i) => {
            // stagger so symbols don't all requote in the same tick
            setTimeout(() => {
                void this.requote(s.symbol);
                this.timers.push(setInterval(() => void this.requote(s.symbol), 5000));
            }, 400 * i);
        });
        this.timers.push(setInterval(() => void this.noiseTrade(), 1500));
    }
    stop() {
        this.timers.forEach(clearInterval);
        this.timers = [];
    }
    async requote(symbol) {
        if (this.busy.has(symbol))
            return;
        this.busy.add(symbol);
        try {
            const ref = SYMBOLS.find((s) => s.symbol === symbol).refPrice;
            let mid = this.mid.get(symbol);
            // random walk + gentle pull back to the reference price
            mid = mid * (1 + (Math.random() - 0.5) * 0.002) + (ref - mid) * 0.02;
            this.mid.set(symbol, mid);
            // MAKE-BEFORE-BREAK: remember the old quotes, place the new ones, THEN cancel the old ones,
            // so the book is never empty (a market order arriving mid-requote still finds liquidity).
            // If a new quote crosses one of the bot's own old quotes, self-trade prevention cancels the old one.
            const old = await Order.find({ userId: new Types.ObjectId(this.mmId), symbol, status: { $in: ['open', 'partial'] } }, '_id').lean();
            const half = Math.max(2 * TICK, Math.round(mid * 0.0004));
            const step = Math.max(TICK, Math.round(mid * 0.0003));
            for (let lvl = 0; lvl < 3; lvl++) {
                const bid = snap(mid - half - lvl * step);
                const ask = snap(mid + half + lvl * step);
                await this.exchange.placeOrder(this.mmId, { symbol, side: 'buy', type: 'limit', price: bid, quantity: rnd(20, 80) }).catch(() => undefined);
                await this.exchange.placeOrder(this.mmId, { symbol, side: 'sell', type: 'limit', price: ask, quantity: rnd(20, 80) }).catch(() => undefined);
            }
            for (const o of old)
                await this.exchange.cancelOrder(this.mmId, String(o._id)).catch(() => undefined); // already-gone orders just 409
        }
        finally {
            this.busy.delete(symbol);
        }
    }
    async noiseTrade() {
        const s = SYMBOLS[rnd(0, SYMBOLS.length - 1)];
        await this.exchange
            .placeOrder(this.takerId, { symbol: s.symbol, side: Math.random() < 0.5 ? 'buy' : 'sell', type: 'market', quantity: rnd(1, 15) })
            .catch(() => undefined);
    }
}
