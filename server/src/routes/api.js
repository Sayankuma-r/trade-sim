import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { Types } from 'mongoose';
import { Order, Trade, User, ORDER_STATUSES } from '../models/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as auth from '../services/auth.js';
import { toOrderDTO } from '../services/exchange.js';
import { loadPortfolio } from '../services/portfolio.js';
import { explainPortfolio } from '../services/ai.js';
import { SYMBOL_MAP } from '../symbols.js';
import { validateCredentials, validateRefreshToken, validateOrder } from '../validate.js';
import { ApiError } from '../errors.js';
import { config } from '../config.js';
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
export function buildRouter(exchange) {
    const r = Router();
    const authLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
    const orderLimiter = rateLimit({
        windowMs: 60_000,
        limit: config.ORDER_RATE_LIMIT_PER_MIN,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user?.id ?? 'anon',
        validate: { keyGeneratorIpFallback: false },
    });
    const aiLimiter = rateLimit({
        windowMs: 60_000,
        limit: 5,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user?.id ?? 'anon',
        validate: { keyGeneratorIpFallback: false },
    });
    r.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
    /* ------------------------------ auth ------------------------------ */
    r.post('/auth/register', authLimiter, wrap(async (req, res) => {
        const { email, password } = validateCredentials(req.body);
        res.status(201).json(await auth.register(email, password));
    }));
    r.post('/auth/login', authLimiter, wrap(async (req, res) => {
        const { email, password } = validateCredentials(req.body);
        res.json(await auth.login(email, password));
    }));
    r.post('/auth/refresh', authLimiter, wrap(async (req, res) => {
        const refreshToken = validateRefreshToken(req.body);
        res.json(await auth.refresh(refreshToken));
    }));
    r.post('/auth/logout', wrap(async (req, res) => {
        const refreshToken = validateRefreshToken(req.body);
        await auth.logout(refreshToken);
        res.status(204).end();
    }));
    r.get('/auth/me', requireAuth, wrap(async (req, res) => {
        const u = await User.findById(req.user.id).lean();
        if (!u)
            throw new ApiError(401, 'NO_USER', 'User not found');
        res.json(auth.publicUser(u));
    }));
    /* ------------------------------ market data (public) ------------------------------ */
    r.get('/market/symbols', (_req, res) => res.json(exchange.getTicker()));
    r.get('/market/:symbol/book', (req, res) => {
        const depth = Math.min(Number(req.query.depth) || 10, 50);
        res.json(exchange.getBook(String(req.params.symbol).toUpperCase(), depth));
    });
    r.get('/market/:symbol/trades', wrap(async (req, res) => {
        const symbol = String(req.params.symbol).toUpperCase();
        if (!SYMBOL_MAP.has(symbol))
            throw new ApiError(404, 'UNKNOWN_SYMBOL', 'Unknown symbol');
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const trades = await Trade.find({ symbol }).sort({ createdAt: -1 }).limit(limit).lean();
        res.json(trades.map((t) => ({ price: t.price, quantity: t.quantity, ts: t.createdAt?.getTime() })));
    }));
    /* ------------------------------ orders ------------------------------ */
    r.post('/orders', requireAuth, orderLimiter, wrap(async (req, res) => {
        const body = validateOrder(req.body);
        const key = req.header('Idempotency-Key');
        if (key !== undefined && !/^[\w.:-]{8,100}$/.test(key)) {
            throw new ApiError(400, 'BAD_IDEMPOTENCY_KEY', 'Idempotency-Key must be 8-100 chars [A-Za-z0-9_.:-]');
        }
        const { order, replay } = await exchange.placeOrder(req.user.id, { ...body, clientOrderId: key });
        if (replay)
            res.setHeader('Idempotent-Replay', 'true');
        res.status(replay ? 200 : 201).json(order);
    }));
    r.get('/orders', requireAuth, wrap(async (req, res) => {
        const filter = { userId: new Types.ObjectId(req.user.id) };
        const status = req.query.status;
        if (ORDER_STATUSES.includes(status))
            filter.status = status;
        if (req.query.open === 'true')
            filter.status = { $in: ['open', 'partial'] };
        const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(100).lean();
        res.json(orders.map((o) => toOrderDTO(o)));
    }));
    r.delete('/orders/:id', requireAuth, orderLimiter, wrap(async (req, res) => {
        res.json(await exchange.cancelOrder(req.user.id, String(req.params.id)));
    }));
    /* ------------------------------ portfolio ------------------------------ */
    r.get('/portfolio', requireAuth, wrap(async (req, res) => {
        res.json(await loadPortfolio(req.user.id, exchange));
    }));
    r.post('/portfolio/explain', requireAuth, aiLimiter, wrap(async (req, res) => {
        const summary = await loadPortfolio(req.user.id, exchange);
        res.json(await explainPortfolio(summary));
    }));
    r.get('/portfolio/trades', requireAuth, wrap(async (req, res) => {
        const uid = new Types.ObjectId(req.user.id);
        const trades = await Trade.find({ $or: [{ buyerId: uid }, { sellerId: uid }] }).sort({ createdAt: -1 }).limit(50).lean();
        res.json(trades.map((t) => ({
            symbol: t.symbol,
            side: String(t.buyerId) === req.user.id ? 'buy' : 'sell',
            price: t.price,
            quantity: t.quantity,
            ts: t.createdAt?.getTime(),
        })));
    }));
    /* ------------------------------ admin (RBAC) ------------------------------ */
    const admin = Router();
    admin.use(requireAuth, requireRole('admin'));
    admin.get('/stats', wrap(async (_req, res) => {
        const [users, orders, trades, openOrders] = await Promise.all([
            User.countDocuments({ isBot: false }),
            Order.countDocuments(),
            Trade.countDocuments(),
            Order.countDocuments({ status: { $in: ['open', 'partial'] } }),
        ]);
        res.json({ users, orders, trades, openOrders, halted: [...exchange.halted] });
    }));
    admin.get('/invariants', wrap(async (_req, res) => {
        res.json(await exchange.checkInvariants());
    }));
    admin.post('/symbols/:symbol/halt', (req, res) => {
        const s = String(req.params.symbol).toUpperCase();
        if (!SYMBOL_MAP.has(s))
            throw new ApiError(404, 'UNKNOWN_SYMBOL', 'Unknown symbol');
        exchange.halted.add(s);
        res.json({ halted: [...exchange.halted] });
    });
    admin.post('/symbols/:symbol/resume', (req, res) => {
        exchange.halted.delete(String(req.params.symbol).toUpperCase());
        res.json({ halted: [...exchange.halted] });
    });
    r.use('/admin', admin);
    return r;
}
