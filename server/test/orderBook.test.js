import { describe, it, expect } from 'vitest';
import { OrderBook } from '../src/engine/orderBook.js';
let n = 0;
const id = () => `o${++n}`;
const limit = (userId, side, price, quantity, oid = id()) => ({
    id: oid, userId, side, type: 'limit', price, quantity,
});
const market = (userId, side, quantity) => ({
    id: id(), userId, side, type: 'market', quantity,
});
describe('OrderBook: resting & priority', () => {
    it('rests a limit order that does not cross', () => {
        const b = new OrderBook('X');
        const r = b.submit(limit('a', 'buy', 100, 10));
        expect(r.fills).toHaveLength(0);
        expect(r.rested).toBe(true);
        expect(b.bestBid()).toBe(100);
        expect(b.bestAsk()).toBeUndefined();
    });
    it('matches at the resting (maker) price, giving the taker price improvement', () => {
        const b = new OrderBook('X');
        b.submit(limit('maker', 'sell', 100, 10));
        const r = b.submit(limit('taker', 'buy', 105, 10));
        expect(r.fills).toHaveLength(1);
        expect(r.fills[0].price).toBe(100);
        expect(r.rested).toBe(false);
        expect(b.size).toBe(0);
    });
    it('price priority: best price first', () => {
        const b = new OrderBook('X');
        b.submit(limit('m1', 'sell', 102, 5));
        b.submit(limit('m2', 'sell', 100, 5));
        b.submit(limit('m3', 'sell', 101, 5));
        const r = b.submit(limit('t', 'buy', 102, 15));
        expect(r.fills.map((f) => f.price)).toEqual([100, 101, 102]);
    });
    it('time priority: FIFO within a price level', () => {
        const b = new OrderBook('X');
        const first = limit('m1', 'sell', 100, 5);
        const second = limit('m2', 'sell', 100, 5);
        b.submit(first);
        b.submit(second);
        const r = b.submit(limit('t', 'buy', 100, 7));
        expect(r.fills.map((f) => [f.makerOrderId, f.quantity])).toEqual([
            [first.id, 5],
            [second.id, 2],
        ]);
        expect(b.get(second.id).remaining).toBe(3);
    });
    it('handles partial fill of taker and rests the remainder', () => {
        const b = new OrderBook('X');
        b.submit(limit('m', 'sell', 100, 4));
        const r = b.submit(limit('t', 'buy', 100, 10));
        expect(r.filled).toBe(4);
        expect(r.remaining).toBe(6);
        expect(r.rested).toBe(true);
        expect(b.bestBid()).toBe(100);
        expect(b.bestAsk()).toBeUndefined();
    });
    it('does not match when limit does not cross', () => {
        const b = new OrderBook('X');
        b.submit(limit('m', 'sell', 101, 5));
        const r = b.submit(limit('t', 'buy', 100, 5));
        expect(r.fills).toHaveLength(0);
        expect(b.bestBid()).toBe(100);
        expect(b.bestAsk()).toBe(101);
    });
    it('sell side crosses bids correctly (best bid first)', () => {
        const b = new OrderBook('X');
        b.submit(limit('b1', 'buy', 98, 5));
        b.submit(limit('b2', 'buy', 100, 5));
        const r = b.submit(limit('s', 'sell', 98, 8));
        expect(r.fills.map((f) => [f.price, f.quantity])).toEqual([[100, 5], [98, 3]]);
        expect(r.fills[0].buyerId).toBe('b2');
        expect(r.fills[0].sellerId).toBe('s');
    });
});
describe('OrderBook: market orders', () => {
    it('walks the book across levels', () => {
        const b = new OrderBook('X');
        b.submit(limit('m', 'sell', 100, 5));
        b.submit(limit('m', 'sell', 110, 5));
        const r = b.submit(market('t', 'buy', 8));
        expect(r.fills.map((f) => [f.price, f.quantity])).toEqual([[100, 5], [110, 3]]);
        expect(r.remaining).toBe(0);
    });
    it('returns remainder (and never rests) when the book runs out', () => {
        const b = new OrderBook('X');
        b.submit(limit('m', 'sell', 100, 3));
        const r = b.submit(market('t', 'buy', 10));
        expect(r.filled).toBe(3);
        expect(r.remaining).toBe(7);
        expect(r.rested).toBe(false);
        expect(b.size).toBe(0);
    });
    it('on an empty book, fills nothing', () => {
        const b = new OrderBook('X');
        const r = b.submit(market('t', 'sell', 10));
        expect(r.filled).toBe(0);
        expect(r.remaining).toBe(10);
    });
    it('estimateBuyCost matches the real execution cost', () => {
        const b = new OrderBook('X');
        b.submit(limit('m', 'sell', 100, 5));
        b.submit(limit('m', 'sell', 110, 5));
        const est = b.estimateBuyCost(8, 't');
        expect(est).toEqual({ cost: 5 * 100 + 3 * 110, fillable: 8 });
        expect(b.estimateBuyCost(50, 't').fillable).toBe(10);
    });
});
describe('OrderBook: cancel', () => {
    it('cancels a resting order and removes the empty level', () => {
        const b = new OrderBook('X');
        const o = limit('a', 'buy', 100, 5);
        b.submit(o);
        const c = b.cancel(o.id);
        expect(c.remaining).toBe(5);
        expect(b.bestBid()).toBeUndefined();
        expect(b.cancel(o.id)).toBeUndefined();
    });
    it('cancel of a partially filled order returns only the remainder', () => {
        const b = new OrderBook('X');
        const o = limit('a', 'sell', 100, 10);
        b.submit(o);
        b.submit(limit('t', 'buy', 100, 4));
        expect(b.cancel(o.id).remaining).toBe(6);
    });
    it('cancelled orders are skipped by matching and keep time priority of others', () => {
        const b = new OrderBook('X');
        const a = limit('a', 'sell', 100, 5);
        const c = limit('c', 'sell', 100, 5);
        const d = limit('d', 'sell', 100, 5);
        [a, c, d].forEach((o) => b.submit(o));
        b.cancel(c.id);
        const r = b.submit(limit('t', 'buy', 100, 10));
        expect(r.fills.map((f) => f.makerOrderId)).toEqual([a.id, d.id]);
    });
    it('level quantity totals stay right after cancels', () => {
        const b = new OrderBook('X');
        const a = limit('a', 'buy', 100, 5);
        b.submit(a);
        b.submit(limit('b', 'buy', 100, 7));
        b.cancel(a.id);
        expect(b.snapshot().bids).toEqual([{ price: 100, quantity: 7, orders: 1 }]);
    });
});
describe('OrderBook: self-trade prevention', () => {
    it('cancels the resting own order instead of trading with yourself', () => {
        const b = new OrderBook('X');
        const mine = limit('me', 'sell', 100, 5);
        b.submit(mine);
        b.submit(limit('other', 'sell', 101, 5));
        const r = b.submit(limit('me', 'buy', 101, 5));
        expect(r.stpCancelled.map((o) => o.id)).toEqual([mine.id]);
        expect(r.fills).toHaveLength(1);
        expect(r.fills[0].sellerId).toBe('other');
        expect(b.has(mine.id)).toBe(false);
    });
});
describe('OrderBook: validation & snapshot', () => {
    it('rejects bad input', () => {
        const b = new OrderBook('X');
        expect(() => b.submit(limit('a', 'buy', 100, 0))).toThrow();
        expect(() => b.submit(limit('a', 'buy', 100.5, 1))).toThrow();
        expect(() => b.submit({ id: 'z', userId: 'a', side: 'buy', type: 'limit', quantity: 1 })).toThrow();
    });
    it('rejects duplicate ids', () => {
        const b = new OrderBook('X');
        const o = limit('a', 'buy', 100, 1);
        b.submit(o);
        expect(() => b.submit({ ...o })).toThrow(/duplicate/);
    });
    it('snapshot is ordered best-first and aggregates levels', () => {
        const b = new OrderBook('X');
        b.submit(limit('a', 'buy', 98, 1));
        b.submit(limit('a', 'buy', 100, 2));
        b.submit(limit('b', 'buy', 100, 3));
        b.submit(limit('a', 'sell', 105, 4));
        b.submit(limit('a', 'sell', 103, 5));
        const s = b.snapshot(5);
        expect(s.bids).toEqual([{ price: 100, quantity: 5, orders: 2 }, { price: 98, quantity: 1, orders: 1 }]);
        expect(s.asks.map((l) => l.price)).toEqual([103, 105]);
    });
});
describe('OrderBook: randomized invariants', () => {
    it('conserves quantity and never leaves a crossed book', () => {
        // deterministic LCG so failures are reproducible
        let seed = 12345;
        const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
        const b = new OrderBook('X');
        const live = [];
        let submitted = 0;
        let traded = 0;
        let cancelled = 0;
        for (let i = 0; i < 5000; i++) {
            const roll = rnd();
            if (roll < 0.15 && live.length) {
                const k = Math.floor(rnd() * live.length);
                const oid = live.splice(k, 1)[0];
                const c = b.cancel(oid);
                if (c)
                    cancelled += c.remaining;
            }
            else {
                const side = rnd() < 0.5 ? 'buy' : 'sell';
                const qty = 1 + Math.floor(rnd() * 20);
                const o = rnd() < 0.2
                    ? market(`u${Math.floor(rnd() * 8)}`, side, qty)
                    : limit(`u${Math.floor(rnd() * 8)}`, side, 95 + Math.floor(rnd() * 11), qty);
                submitted += qty;
                const r = b.submit(o);
                traded += r.fills.reduce((s, f) => s + f.quantity, 0) * 2; // both sides
                cancelled += r.stpCancelled.reduce((s, x) => s + x.remaining, 0);
                // market remainder is dropped by the engine
                if (o.type === 'market')
                    cancelled += r.remaining;
                if (r.rested)
                    live.push(o.id);
                for (const f of r.fills)
                    expect(f.makerUserId).not.toBe(f.takerUserId);
            }
            const bb = b.bestBid();
            const ba = b.bestAsk();
            if (bb !== undefined && ba !== undefined)
                expect(bb).toBeLessThan(ba);
        }
        let resting = 0;
        for (const side of [b.bids, b.asks])
            for (const l of side.levels.values())
                resting += l.total;
        // every order's qty = filled + cancelled/dropped + resting; each fill counts on both sides
        expect(traded + cancelled + resting).toBe(submitted);
    });
});
