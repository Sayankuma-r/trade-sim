import mongoose, { Schema } from 'mongoose';
const opts = { timestamps: true };
/* ---------- User ---------- */
const userSchema = new Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isBot: { type: Boolean, default: false },
}, opts);
/* ---------- Account (cash). All amounts: integer paise ---------- */
const accountSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    available: { type: Number, required: true, min: 0 },
    locked: { type: Number, required: true, min: 0, default: 0 },
    /** Cash the account was created with. Used by the conservation-of-money invariant. */
    initial: { type: Number, required: true },
}, opts);
/* ---------- Position (shares) ---------- */
const positionSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    symbol: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0, default: 0 },
    lockedQuantity: { type: Number, required: true, min: 0, default: 0 },
    /** Total paise paid for the shares currently held (avg price = costBasis / (quantity+lockedQuantity)). */
    costBasis: { type: Number, required: true, default: 0 },
    realizedPnl: { type: Number, required: true, default: 0 },
    /** Shares granted at creation (bots only). Used by the conservation-of-shares invariant. */
    seeded: { type: Number, required: true, default: 0 },
}, opts);
positionSchema.index({ userId: 1, symbol: 1 }, { unique: true });
/* ---------- Order ---------- */
export const ORDER_STATUSES = ['open', 'partial', 'filled', 'cancelled', 'rejected'];
const orderSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    symbol: { type: String, required: true },
    side: { type: String, enum: ['buy', 'sell'], required: true },
    type: { type: String, enum: ['limit', 'market'], required: true },
    price: { type: Number }, // limit price, paise
    quantity: { type: Number, required: true },
    filledQty: { type: Number, required: true, default: 0 },
    filledValue: { type: Number, required: true, default: 0 }, // paise, for avg fill price
    status: { type: String, enum: ORDER_STATUSES, default: 'open' },
    /** Cash still reserved (locked) for this BUY order. */
    reservedCash: { type: Number, required: true, default: 0 },
    /** Idempotency key. Unique per user. */
    clientOrderId: { type: String, required: true },
    requestHash: { type: String, required: true },
}, opts);
orderSchema.index({ userId: 1, clientOrderId: 1 }, { unique: true });
orderSchema.index({ symbol: 1, status: 1 });
orderSchema.index({ userId: 1, createdAt: -1 });
/* ---------- Trade ---------- */
const tradeSchema = new Schema({
    symbol: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
    buyOrderId: { type: Schema.Types.ObjectId, required: true },
    sellOrderId: { type: Schema.Types.ObjectId, required: true },
    buyerId: { type: Schema.Types.ObjectId, required: true },
    sellerId: { type: Schema.Types.ObjectId, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
tradeSchema.index({ symbol: 1, createdAt: -1 });
tradeSchema.index({ buyerId: 1, createdAt: -1 });
tradeSchema.index({ sellerId: 1, createdAt: -1 });
/* ---------- Refresh token (hashed, rotated on use, TTL-expired) ---------- */
const refreshSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
});
export const User = mongoose.model('User', userSchema);
export const Account = mongoose.model('Account', accountSchema);
export const Position = mongoose.model('Position', positionSchema);
export const Order = mongoose.model('Order', orderSchema);
export const Trade = mongoose.model('Trade', tradeSchema);
export const RefreshToken = mongoose.model('RefreshToken', refreshSchema);
export async function syncIndexes() {
    // Unique indexes are what make idempotency and "one account per user" hold under concurrency.
    await Promise.all([User, Account, Position, Order, Trade].map((m) => m.createIndexes()));
    // The TTL index only garbage-collects expired refresh tokens (queries already ignore expired ones),
    // so a server that can't build it should not stop the app from booting.
    await RefreshToken.createIndexes().catch((e) => console.warn('[db] refresh-token TTL index not created:', e.message));
}
