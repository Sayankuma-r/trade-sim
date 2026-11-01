import bcrypt from 'bcryptjs';
import { Account, Position, User } from '../models/index.js';
import { config } from '../config.js';
import { SYMBOLS } from '../symbols.js';
export const BOT_MM_EMAIL = 'marketmaker@bot.tradesim.dev';
export const BOT_TAKER_EMAIL = 'noise@bot.tradesim.dev';
async function ensureUser(email, passwordHash, role, isBot) {
    const u = await User.findOneAndUpdate({ email }, { $setOnInsert: { email, passwordHash, role, isBot } }, { upsert: true, returnDocument: 'after' });
    return u;
}
/** Seed the admin and the two bots (idempotent: safe to run on every boot). */
export async function seed(startingCash) {
    const admin = await ensureUser(config.ADMIN_EMAIL.toLowerCase(), await bcrypt.hash(config.ADMIN_PASSWORD, 10), 'admin', false);
    await Account.updateOne({ userId: admin._id }, { $setOnInsert: { available: startingCash, locked: 0, initial: startingCash } }, { upsert: true });
    const bots = {};
    const specs = [
        { email: BOT_MM_EMAIL, cash: 1_000_000_000_000, shares: 500_000 }, // market maker: lots of both
        { email: BOT_TAKER_EMAIL, cash: 100_000_000_000, shares: 50_000 },
    ];
    for (const s of specs) {
        // '!' is not a valid bcrypt hash → nobody can ever log in as a bot
        const u = await ensureUser(s.email, '!', 'user', true);
        bots[s.email] = String(u._id);
        await Account.updateOne({ userId: u._id }, { $setOnInsert: { available: s.cash, locked: 0, initial: s.cash } }, { upsert: true });
        for (const sym of SYMBOLS) {
            await Position.updateOne({ userId: u._id, symbol: sym.symbol }, { $setOnInsert: { quantity: s.shares, lockedQuantity: 0, costBasis: s.shares * sym.refPrice, realizedPnl: 0, seeded: s.shares } }, { upsert: true });
        }
    }
    return { mmId: bots[BOT_MM_EMAIL], takerId: bots[BOT_TAKER_EMAIL] };
}
