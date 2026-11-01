import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as ioc } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { attachSocket } from '../src/ws/socket.js';
import { seed } from '../src/services/seed.js';
import { STARTING_CASH, config } from '../src/config.js';
import { Position } from '../src/models/index.js';
import { startTestExchange } from './helpers.js';
let ex;
let stop;
let server;
let base;
let api;
beforeAll(async () => {
    const t = await startTestExchange();
    ex = t.exchange;
    stop = t.stop;
    await seed(STARTING_CASH);
    ex.startBroadcasting();
    const app = createApp(ex);
    server = http.createServer(app);
    attachSocket(server, ex);
    await new Promise((r) => server.listen(0, r));
    base = `http://127.0.0.1:${server.address().port}`;
    api = request(base);
});
afterAll(async () => {
    ex.stop();
    server.close();
    await stop();
});
const signup = async (email) => {
    const r = await api.post('/api/auth/register').send({ email, password: 'password123' });
    expect(r.status).toBe(201);
    return r.body;
};
const authed = (t) => ({ Authorization: `Bearer ${t}` });
describe('auth', () => {
    it('registers, logs in, rejects bad credentials and duplicate emails', async () => {
        await signup('a@test.dev');
        expect((await api.post('/api/auth/register').send({ email: 'a@test.dev', password: 'password123' })).status).toBe(409);
        expect((await api.post('/api/auth/login').send({ email: 'a@test.dev', password: 'wrong-password' })).status).toBe(401);
        const ok = await api.post('/api/auth/login').send({ email: 'A@test.dev', password: 'password123' });
        expect(ok.status).toBe(200);
        expect(ok.body.accessToken).toBeTruthy();
        expect(JSON.stringify(ok.body)).not.toContain('passwordHash');
    });
    it('validates input', async () => {
        expect((await api.post('/api/auth/register').send({ email: 'nope', password: 'password123' })).status).toBe(400);
        expect((await api.post('/api/auth/register').send({ email: 'x@test.dev', password: 'short' })).status).toBe(400);
    });
    it('refresh tokens rotate: each works once', async () => {
        const s = await signup('rot@test.dev');
        const first = await api.post('/api/auth/refresh').send({ refreshToken: s.refreshToken });
        expect(first.status).toBe(200);
        expect(first.body.refreshToken).not.toBe(s.refreshToken);
        expect((await api.post('/api/auth/refresh').send({ refreshToken: s.refreshToken })).status).toBe(401); // reuse
        await api.post('/api/auth/logout').send({ refreshToken: first.body.refreshToken }).expect(204);
        expect((await api.post('/api/auth/refresh').send({ refreshToken: first.body.refreshToken })).status).toBe(401);
    });
    it('protects routes and enforces roles', async () => {
        expect((await api.get('/api/portfolio')).status).toBe(401);
        expect((await api.get('/api/portfolio').set('Authorization', 'Bearer garbage')).status).toBe(401);
        const u = await signup('plain@test.dev');
        expect((await api.get('/api/admin/stats').set(authed(u.accessToken))).status).toBe(403);
        const admin = await api.post('/api/auth/login').send({ email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD });
        expect(admin.status).toBe(200);
        const inv = await api.get('/api/admin/invariants').set(authed(admin.body.accessToken));
        expect(inv.status).toBe(200);
        expect(inv.body.ok).toBe(true);
    });
    it('bots cannot log in', async () => {
        const r = await api.post('/api/auth/login').send({ email: 'marketmaker@bot.tradesim.dev', password: 'anything123' });
        expect(r.status).toBe(401);
    });
});
describe('orders over HTTP', () => {
    it('validates order payloads', async () => {
        const u = await signup('v@test.dev');
        const post = (b) => api.post('/api/orders').set(authed(u.accessToken)).send(b);
        expect((await post({ symbol: 'NOPE', side: 'buy', type: 'limit', price: 100, quantity: 1 })).status).toBe(400);
        expect((await post({ symbol: 'TCS', side: 'buy', type: 'limit', quantity: 1 })).status).toBe(400); // limit w/o price
        expect((await post({ symbol: 'TCS', side: 'buy', type: 'market', price: 100, quantity: 1 })).status).toBe(400); // market with price
        expect((await post({ symbol: 'TCS', side: 'buy', type: 'limit', price: 100.5, quantity: 1 })).status).toBe(400); // float price
        expect((await post({ symbol: 'TCS', side: 'buy', type: 'limit', price: 101, quantity: 1 })).status).toBe(400); // off-tick
        expect((await post({ symbol: 'TCS', side: 'buy', type: 'limit', price: 100, quantity: 0 })).status).toBe(400);
        expect((await post({ symbol: 'TCS', side: 'buy', type: 'limit', price: 100, quantity: 1.5 })).status).toBe(400);
    });
    it('Idempotency-Key: replay returns the same order with a replay header', async () => {
        const u = await signup('idem@test.dev');
        const body = { symbol: 'RELIANCE', side: 'buy', type: 'limit', price: 100_000, quantity: 2 };
        const a = await api.post('/api/orders').set(authed(u.accessToken)).set('Idempotency-Key', 'key-0001-abcdef').send(body);
        const b = await api.post('/api/orders').set(authed(u.accessToken)).set('Idempotency-Key', 'key-0001-abcdef').send(body);
        expect(a.status).toBe(201);
        expect(b.status).toBe(200);
        expect(b.headers['idempotent-replay']).toBe('true');
        expect(b.body.id).toBe(a.body.id);
        const c = await api.post('/api/orders').set(authed(u.accessToken)).set('Idempotency-Key', 'key-0001-abcdef').send({ ...body, quantity: 3 });
        expect(c.status).toBe(422);
        const list = await api.get('/api/orders?open=true').set(authed(u.accessToken));
        expect(list.body).toHaveLength(1);
        const pf = await api.get('/api/portfolio').set(authed(u.accessToken));
        expect(pf.body.lockedCash).toBe(200_000);
    });
    it('a user cannot cancel someone else\'s order', async () => {
        const a = await signup('own1@test.dev');
        const b = await signup('own2@test.dev');
        const o = await api.post('/api/orders').set(authed(a.accessToken)).send({ symbol: 'ITC', side: 'buy', type: 'limit', price: 10_000, quantity: 1 });
        expect((await api.delete(`/api/orders/${o.body.id}`).set(authed(b.accessToken))).status).toBe(404);
        expect((await api.delete(`/api/orders/${o.body.id}`).set(authed(a.accessToken))).status).toBe(200);
        expect((await api.delete(`/api/orders/${o.body.id}`).set(authed(a.accessToken))).status).toBe(409);
    });
});
describe('portfolio + AI explainer', () => {
    it('computes holdings deterministically and explains them (template fallback without API key)', async () => {
        const seller = await signup('s@test.dev');
        const buyer = await signup('b@test.dev');
        const sid = seller.user.id;
        await Position.create({ userId: sid, symbol: 'TCS', quantity: 10, lockedQuantity: 0, costBasis: 10 * 400_000, seeded: 10 });
        await api.post('/api/orders').set(authed(seller.accessToken)).send({ symbol: 'TCS', side: 'sell', type: 'limit', price: 410_000, quantity: 10 }).expect(201);
        const fill = await api.post('/api/orders').set(authed(buyer.accessToken)).send({ symbol: 'TCS', side: 'buy', type: 'market', quantity: 4 });
        expect(fill.body.status).toBe('filled');
        const pf = await api.get('/api/portfolio').set(authed(buyer.accessToken));
        expect(pf.body.holdings).toHaveLength(1);
        expect(pf.body.holdings[0]).toMatchObject({ symbol: 'TCS', quantity: 4, avgPrice: 410_000, weightPct: 100 });
        expect(pf.body.cash).toBe(STARTING_CASH - 4 * 410_000);
        expect(pf.body.riskLevel).toBe('high'); // 100% in one stock
        expect(pf.body.equity).toBe(STARTING_CASH); // marked at the last trade → no P&L yet
        const ex1 = await api.post('/api/portfolio/explain').set(authed(buyer.accessToken));
        expect(ex1.status).toBe(200);
        expect(ex1.body.source).toBe('template');
        expect(ex1.body.text).toContain('TCS');
        const ex2 = await api.post('/api/portfolio/explain').set(authed(buyer.accessToken));
        expect(ex2.body.cached).toBe(true);
    });
});
describe('websocket', () => {
    it('rejects unauthenticated sockets; authenticated ones get book + trade + refresh events', async () => {
        const bad = ioc(base, { auth: {}, reconnection: false });
        await new Promise((res) => bad.on('connect_error', () => res()));
        bad.close();
        const a = await signup('ws1@test.dev');
        const b = await signup('ws2@test.dev');
        await Position.create({ userId: a.user.id, symbol: 'INFY', quantity: 5, lockedQuantity: 0, costBasis: 5 * 165_000, seeded: 5 });
        const sock = ioc(base, { auth: { token: b.accessToken }, reconnection: false });
        const got = { book: [], trade: [], refresh: [] };
        for (const ev of Object.keys(got))
            sock.on(ev, (p) => got[ev].push(p));
        await new Promise((res) => sock.on('connect', () => res()));
        sock.emit('subscribe', 'INFY');
        await api.post('/api/orders').set(authed(a.accessToken)).send({ symbol: 'INFY', side: 'sell', type: 'limit', price: 165_000, quantity: 5 }).expect(201);
        await api.post('/api/orders').set(authed(b.accessToken)).send({ symbol: 'INFY', side: 'buy', type: 'limit', price: 165_000, quantity: 2 }).expect(201);
        await new Promise((r) => setTimeout(r, 400));
        sock.close();
        expect(got.book.length).toBeGreaterThan(0);
        expect(got.trade).toEqual([expect.objectContaining({ symbol: 'INFY', price: 165_000, quantity: 2 })]);
        expect(got.refresh.length).toBeGreaterThan(0); // b's order filled → told to refetch
        const lastBook = got.book.at(-1);
        expect(lastBook.asks[0]).toMatchObject({ price: 165_000, quantity: 3 });
    });
});
