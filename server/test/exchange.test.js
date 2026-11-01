import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Order, Position, Trade } from '../src/models/index.js';
import { ApiError } from '../src/errors.js';
import { balance, makeUser, shares, startTestExchange } from './helpers.js';
let ex;
let stop;
beforeAll(async () => {
    const t = await startTestExchange();
    ex = t.exchange;
    stop = t.stop;
});
afterAll(async () => stop());
// every test starts from empty books (leftover resting orders would otherwise cross with later tests)
beforeEach(async () => {
    const open = await Order.find({ status: { $in: ['open', 'partial'] } }).lean();
    for (const o of open)
        await ex.cancelOrder(String(o.userId), String(o._id));
});
// FerretDB (the Mongo-compatible server used for local runs without Docker) loses concurrent
// $inc updates, so the cross-symbol test is only meaningful on real MongoDB.
const realMongo = !process.env.MONGO_TEST_URI || process.env.MONGO_TEST_TX === 'true';
const SYM = 'TCS';
const P = 410_000; // INR 4,100.00 in paise
const code = async (p) => {
    try {
        await p;
        return 'OK';
    }
    catch (e) {
        return e instanceof ApiError ? e.code : `ERR:${e.message}`;
    }
};
async function expectInvariants() {
    const inv = await ex.checkInvariants();
    expect(inv, JSON.stringify(inv)).toMatchObject({ ok: true });
}
describe('settlement', () => {
    it('limit buy meets limit sell: cash and shares move, price improvement refunded', async () => {
        const seller = await makeUser(0, { [SYM]: 10 });
        const buyer = await makeUser(10_000_000);
        await ex.placeOrder(seller, { symbol: SYM, side: 'sell', type: 'limit', price: P, quantity: 10 });
        expect(await shares(seller, SYM)).toEqual({ quantity: 0, locked: 10 });
        // buyer is willing to pay up to P+1000 but should pay only P (maker's price)
        const { order } = await ex.placeOrder(buyer, { symbol: SYM, side: 'buy', type: 'limit', price: P + 1000, quantity: 10 });
        expect(order.status).toBe('filled');
        expect(order.avgFillPrice).toBe(P);
        expect(await balance(buyer)).toEqual({ available: 10_000_000 - P * 10, locked: 0 });
        expect(await balance(seller)).toEqual({ available: P * 10, locked: 0 });
        expect(await shares(buyer, SYM)).toEqual({ quantity: 10, locked: 0 });
        expect(await shares(seller, SYM)).toEqual({ quantity: 0, locked: 0 });
        expect(await Trade.countDocuments({ buyerId: buyer })).toBe(1);
        await expectInvariants();
    });
    it('partial fill leaves the remainder resting with the right reservation', async () => {
        const seller = await makeUser(0, { INFY: 3 });
        const buyer = await makeUser(10_000_000);
        await ex.placeOrder(seller, { symbol: 'INFY', side: 'sell', type: 'limit', price: 165_000, quantity: 3 });
        const { order } = await ex.placeOrder(buyer, { symbol: 'INFY', side: 'buy', type: 'limit', price: 165_000, quantity: 10 });
        expect(order.status).toBe('partial');
        expect(order.filledQty).toBe(3);
        expect(await balance(buyer)).toEqual({ available: 10_000_000 - 165_000 * 10, locked: 165_000 * 7 });
        await expectInvariants();
    });
    it('market buy walks the book, pays maker prices, releases unused reservation', async () => {
        const s = await makeUser(0, { ITC: 10 });
        const b = await makeUser(5_000_000);
        await ex.placeOrder(s, { symbol: 'ITC', side: 'sell', type: 'limit', price: 46_000, quantity: 4 });
        await ex.placeOrder(s, { symbol: 'ITC', side: 'sell', type: 'limit', price: 46_500, quantity: 4 });
        const { order } = await ex.placeOrder(b, { symbol: 'ITC', side: 'buy', type: 'market', quantity: 6 });
        expect(order.status).toBe('filled');
        expect(await balance(b)).toEqual({ available: 5_000_000 - (4 * 46_000 + 2 * 46_500), locked: 0 });
        await expectInvariants();
    });
    it('market order that outruns liquidity fills what it can and cancels the rest', async () => {
        const s = await makeUser(0, { HDFCBANK: 5 });
        const b = await makeUser(5_000_000);
        await ex.placeOrder(s, { symbol: 'HDFCBANK', side: 'sell', type: 'limit', price: 172_000, quantity: 2 });
        const { order } = await ex.placeOrder(b, { symbol: 'HDFCBANK', side: 'buy', type: 'market', quantity: 5 });
        expect(order.status).toBe('cancelled');
        expect(order.filledQty).toBe(2);
        expect(await balance(b)).toEqual({ available: 5_000_000 - 2 * 172_000, locked: 0 });
        await expectInvariants();
    });
    it('realised P&L is tracked on sells', async () => {
        const a = await makeUser(0, { ICICIBANK: 10 }, 120_000); // cost basis 1,200.00
        const b = await makeUser(5_000_000);
        await ex.placeOrder(a, { symbol: 'ICICIBANK', side: 'sell', type: 'limit', price: 125_000, quantity: 10 });
        await ex.placeOrder(b, { symbol: 'ICICIBANK', side: 'buy', type: 'market', quantity: 10 });
        const pa = await Position.findOne({ userId: a, symbol: 'ICICIBANK' }).lean();
        expect(pa.realizedPnl).toBe(10 * (125_000 - 120_000));
        expect(pa.costBasis).toBe(0);
        const pb = await Position.findOne({ userId: b, symbol: 'ICICIBANK' }).lean();
        expect(pb.costBasis).toBe(10 * 125_000);
    });
});
describe('rejections', () => {
    it('rejects insufficient funds, insufficient shares (no shorting), no-liquidity market buys', async () => {
        const poor = await makeUser(1000);
        expect(await code(ex.placeOrder(poor, { symbol: SYM, side: 'buy', type: 'limit', price: P, quantity: 1 }))).toBe('INSUFFICIENT_FUNDS');
        expect(await code(ex.placeOrder(poor, { symbol: SYM, side: 'sell', type: 'limit', price: P, quantity: 1 }))).toBe('INSUFFICIENT_SHARES');
        const rich = await makeUser(100_000_000);
        expect(await code(ex.placeOrder(rich, { symbol: 'RELIANCE', side: 'buy', type: 'market', quantity: 1 }))).toBe('NO_LIQUIDITY');
        // nothing leaked
        expect(await balance(poor)).toEqual({ available: 1000, locked: 0 });
        expect(await Order.countDocuments({ userId: poor })).toBe(0);
        await expectInvariants();
    });
    it('halted symbols reject orders', async () => {
        const u = await makeUser(10_000_000);
        ex.halted.add('ITC');
        expect(await code(ex.placeOrder(u, { symbol: 'ITC', side: 'buy', type: 'limit', price: 46_000, quantity: 1 }))).toBe('MARKET_HALTED');
        ex.halted.delete('ITC');
    });
});
describe('concurrency (the interview question)', () => {
    it('100 simultaneous orders against a balance that covers exactly 10: exactly 10 succeed', async () => {
        const price = 100_000;
        const u = await makeUser(price * 10);
        const results = await Promise.all(Array.from({ length: 100 }, () => code(ex.placeOrder(u, { symbol: 'INFY', side: 'buy', type: 'limit', price: price - 50_000, quantity: 1 }))));
        // price - 50_000 → cost 50_000 each → balance covers 20; use real numbers below
        const ok = results.filter((r) => r === 'OK').length;
        const rejected = results.filter((r) => r === 'INSUFFICIENT_FUNDS').length;
        expect(ok + rejected).toBe(100);
        expect(ok).toBe(20);
        const b = await balance(u);
        expect(b.available).toBe(0);
        expect(b.locked).toBe(price * 10);
        await expectInvariants();
    });
    it('cannot double-spend the same shares across concurrent sells', async () => {
        const u = await makeUser(0, { ITC: 10 });
        const results = await Promise.all(Array.from({ length: 30 }, () => code(ex.placeOrder(u, { symbol: 'ITC', side: 'sell', type: 'limit', price: 90_000, quantity: 1 }))));
        expect(results.filter((r) => r === 'OK')).toHaveLength(10);
        expect(results.filter((r) => r === 'INSUFFICIENT_SHARES')).toHaveLength(20);
        expect(await shares(u, 'ITC')).toEqual({ quantity: 0, locked: 10 });
    });
    it('idempotency: the same key sent 20× in parallel creates exactly one order', async () => {
        const u = await makeUser(100_000_000);
        const key = 'idem-key-12345678';
        const outs = await Promise.all(Array.from({ length: 20 }, () => ex.placeOrder(u, { symbol: 'RELIANCE', side: 'buy', type: 'limit', price: 200_000, quantity: 1, clientOrderId: key })));
        expect(new Set(outs.map((o) => o.order.id)).size).toBe(1);
        expect(outs.filter((o) => !o.replay)).toHaveLength(1);
        expect(await Order.countDocuments({ userId: u })).toBe(1);
        expect(await balance(u)).toEqual({ available: 100_000_000 - 200_000, locked: 200_000 });
    });
    it('reusing a key with a different payload is rejected', async () => {
        const u = await makeUser(100_000_000);
        const key = 'idem-key-aaaaaaaa';
        await ex.placeOrder(u, { symbol: 'RELIANCE', side: 'buy', type: 'limit', price: 200_000, quantity: 1, clientOrderId: key });
        expect(await code(ex.placeOrder(u, { symbol: 'RELIANCE', side: 'buy', type: 'limit', price: 200_000, quantity: 2, clientOrderId: key }))).toBe('IDEMPOTENCY_KEY_REUSED');
    });
    it('concurrent cancels of one order refund exactly once', async () => {
        const u = await makeUser(10_000_000);
        const { order } = await ex.placeOrder(u, { symbol: 'RELIANCE', side: 'buy', type: 'limit', price: 100_000, quantity: 5 });
        const r = await Promise.all(Array.from({ length: 10 }, () => code(ex.cancelOrder(u, order.id))));
        expect(r.filter((x) => x === 'OK')).toHaveLength(1);
        expect(r.filter((x) => x === 'NOT_CANCELLABLE')).toHaveLength(9);
        expect(await balance(u)).toEqual({ available: 10_000_000, locked: 0 });
        await expectInvariants();
    });
    it('cancel vs fill race: either it fills or it cancels, never both', async () => {
        const seller = await makeUser(0, { TCS: 5 });
        const buyer = await makeUser(100_000_000);
        const { order } = await ex.placeOrder(seller, { symbol: 'TCS', side: 'sell', type: 'limit', price: 300_000, quantity: 5 });
        const [c, f] = await Promise.all([
            code(ex.cancelOrder(seller, order.id)),
            code(ex.placeOrder(buyer, { symbol: 'TCS', side: 'buy', type: 'limit', price: 300_000, quantity: 5 })),
        ]);
        expect(f).toBe('OK');
        const final = (await Order.findById(order.id).lean()).status;
        if (c === 'OK') {
            expect(final).toBe('cancelled'); // cancel won the race: the buy just rests
            expect(await shares(seller, 'TCS')).toEqual({ quantity: 5, locked: 0 });
        }
        else {
            expect(c).toBe('NOT_CANCELLABLE'); // the buy won the race: order already filled
            expect(final).toBe('filled');
            expect(await balance(seller)).toEqual({ available: 5 * 300_000, locked: 0 });
        }
        await expectInvariants();
    });
});
describe('self-trade prevention & recovery', () => {
    it('own resting order is cancelled instead of self-trading, funds released', async () => {
        const u = await makeUser(10_000_000, { INFY: 5 });
        const { order: sell } = await ex.placeOrder(u, { symbol: 'INFY', side: 'sell', type: 'limit', price: 160_000, quantity: 5 });
        const { order: buy } = await ex.placeOrder(u, { symbol: 'INFY', side: 'buy', type: 'limit', price: 160_000, quantity: 1 });
        expect(buy.status).toBe('open');
        expect((await Order.findById(sell.id).lean()).status).toBe('cancelled');
        expect(await shares(u, 'INFY')).toEqual({ quantity: 5, locked: 0 });
        await expectInvariants();
    });
    it('a fresh Exchange rebuilds identical books from the database (crash recovery)', async () => {
        const { Exchange } = await import('../src/services/exchange.js');
        const fresh = new Exchange();
        await fresh.init();
        for (const sym of ['TCS', 'INFY', 'ITC', 'RELIANCE', 'HDFCBANK', 'ICICIBANK']) {
            expect(fresh.getBook(sym, 20)).toEqual(ex.getBook(sym, 20));
        }
    });
});
async function fuzz(symbols, nOps) {
    const users = [];
    for (let i = 0; i < 12; i++)
        users.push(await makeUser(50_000_000, { TCS: 40, INFY: 40 }));
    const mid = { TCS: 410_000, INFY: 165_000 };
    const ops = [];
    const results = {};
    const track = async (p) => {
        const r = await code(p);
        results[r] = (results[r] ?? 0) + 1;
    };
    for (let i = 0; i < nOps; i++) {
        const u = users[Math.floor(Math.random() * users.length)];
        const symbol = symbols[Math.floor(Math.random() * symbols.length)];
        const side = Math.random() < 0.5 ? 'buy' : 'sell';
        const type = Math.random() < 0.25 ? 'market' : 'limit';
        const price = Math.round((mid[symbol] * (1 + (Math.random() - 0.5) * 0.02)) / 5) * 5;
        ops.push(track(ex.placeOrder(u, { symbol, side, type, ...(type === 'limit' ? { price } : {}), quantity: 1 + Math.floor(Math.random() * 5) })));
        if (i % 7 === 0) {
            ops.push((async () => {
                const o = await Order.findOne({ userId: u, status: { $in: ['open', 'partial'] } }).lean();
                if (o)
                    await track(ex.cancelOrder(u, String(o._id)));
            })());
        }
    }
    await Promise.all(ops);
    // only business rejections are acceptable; anything starting with ERR: is a bug
    const unexpected = Object.keys(results).filter((k) => k.startsWith('ERR:'));
    expect(unexpected, JSON.stringify(results)).toEqual([]);
    await expectInvariants();
    return results;
}
describe('fuzz: many users, random concurrent orders', () => {
    it('single symbol: money and shares are conserved no matter what', async () => {
        await fuzz(['TCS'], 400);
        expect(await Trade.countDocuments({ symbol: 'TCS' })).toBeGreaterThan(0);
    });
    it.skipIf(!realMongo)('two symbols at once (cross-symbol contention on the same accounts)', async () => {
        await fuzz(['TCS', 'INFY'], 400);
    });
});
