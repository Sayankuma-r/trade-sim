import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { Account, Position, User, syncIndexes } from '../src/models/index.js';
import { Exchange } from '../src/services/exchange.js';
import { bus, cache } from '../src/services/bus.js';
export async function startTestExchange() {
    const dbName = 'tradesim_test_' + Math.random().toString(36).slice(2, 10);
    await mongoose.connect(process.env.MONGO_URI, { dbName });
    await syncIndexes();
    await bus.start();
    cache.start();
    const exchange = new Exchange();
    await exchange.init();
    return {
        exchange,
        async stop() {
            exchange.stop();
            await mongoose.connection.dropDatabase().catch(() => undefined);
            await mongoose.disconnect();
        },
    };
}
let counter = 0;
/** Create a user with `cash` paise and optional `{ SYMBOL: shares }` (granted as "seeded" so invariants hold). */
export async function makeUser(cash, shares = {}, price = 100_000) {
    const u = await User.create({ email: `u${++counter}_${Math.random().toString(36).slice(2, 6)}@t.dev`, passwordHash: await bcrypt.hash('password123', 4) });
    await Account.create({ userId: u._id, available: cash, locked: 0, initial: cash });
    for (const [symbol, q] of Object.entries(shares)) {
        await Position.create({ userId: u._id, symbol, quantity: q, lockedQuantity: 0, costBasis: q * price, seeded: q });
    }
    return String(u._id);
}
export async function balance(userId) {
    const a = await Account.findOne({ userId }).lean();
    return { available: a.available, locked: a.locked };
}
export async function shares(userId, symbol) {
    const p = await Position.findOne({ userId, symbol }).lean();
    return { quantity: p?.quantity ?? 0, locked: p?.lockedQuantity ?? 0 };
}
