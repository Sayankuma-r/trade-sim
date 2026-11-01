/**
 * Pure, in-memory limit order book with price-time priority.
 *
 * - No database, no I/O, no async: this makes it trivial to unit test.
 * - Prices and quantities are INTEGERS (price in paise). Never floats.
 * - Best price of each side is kept at the END of a sorted array, so reading
 *   and removing the best level is O(1); inserting a new level is O(log n)
 *   to find + O(n) splice (n = number of distinct price levels, which is small).
 * - Cancels are O(1) (tombstone) and removing an empty level is O(log n) + splice.
 * - Orders at the same price are served FIFO (time priority).
 * - Trades execute at the RESTING (maker) order's price.
 * - Self-trade prevention: if the incoming order would match one of the same
 *   user's resting orders, that resting order is cancelled ("cancel-resting")
 *   and reported in `stpCancelled` so the caller can release its reservation.
 */
class PriceLevel {
    price;
    orders = [];
    head = 0;
    /** Sum of `remaining` of all live orders at this level. */
    total = 0;
    live = 0;
    constructor(price) {
        this.price = price;
    }
    push(o) {
        this.orders.push(o);
        this.total += o.remaining;
        this.live += 1;
    }
    /** Oldest live order (skips cancelled tombstones). */
    peek() {
        while (this.head < this.orders.length && this.orders[this.head].remaining === 0)
            this.head++;
        if (this.head > 1024 && this.head * 2 > this.orders.length) {
            this.orders = this.orders.slice(this.head);
            this.head = 0;
        }
        return this.orders[this.head];
    }
}
class BookSide {
    isBid;
    levels = new Map();
    /** Sorted WORST -> BEST, so the best price is always the last element. */
    prices = [];
    constructor(isBid) {
        this.isBid = isBid;
    }
    /** Ascending in "goodness": bids: low->high, asks: high->low. */
    goodness(a, b) {
        return this.isBid ? a - b : b - a;
    }
    best() {
        return this.prices[this.prices.length - 1];
    }
    level(price) {
        let lvl = this.levels.get(price);
        if (!lvl) {
            lvl = new PriceLevel(price);
            this.levels.set(price, lvl);
            // binary search for insertion index
            let lo = 0;
            let hi = this.prices.length;
            while (lo < hi) {
                const mid = (lo + hi) >>> 1;
                if (this.goodness(this.prices[mid], price) < 0)
                    lo = mid + 1;
                else
                    hi = mid;
            }
            this.prices.splice(lo, 0, price);
        }
        return lvl;
    }
    removeLevel(price) {
        this.levels.delete(price);
        let lo = 0;
        let hi = this.prices.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            const c = this.goodness(this.prices[mid], price);
            if (c === 0) {
                this.prices.splice(mid, 1);
                return;
            }
            if (c < 0)
                lo = mid + 1;
            else
                hi = mid - 1;
        }
    }
    depth(n) {
        const out = [];
        for (let i = this.prices.length - 1; i >= 0 && out.length < n; i--) {
            const lvl = this.levels.get(this.prices[i]);
            out.push({ price: lvl.price, quantity: lvl.total, orders: lvl.live });
        }
        return out;
    }
}
export class OrderBook {
    symbol;
    bids = new BookSide(true);
    asks = new BookSide(false);
    index = new Map();
    constructor(symbol) {
        this.symbol = symbol;
    }
    get size() {
        return this.index.size;
    }
    bestBid() {
        return this.bids.best();
    }
    bestAsk() {
        return this.asks.best();
    }
    has(orderId) {
        return this.index.has(orderId);
    }
    get(orderId) {
        return this.index.get(orderId);
    }
    /** Put a limit order straight on the book (used to rebuild from the DB). */
    rest(o) {
        if (o.remaining <= 0)
            return;
        const side = o.side === 'buy' ? this.bids : this.asks;
        side.level(o.price).push(o);
        this.index.set(o.id, o);
    }
    /**
     * Submit an order: match against the opposite side, rest any remainder
     * (limit only). Market remainders are NOT rested; the caller cancels them.
     */
    submit(order) {
        if (!Number.isSafeInteger(order.quantity) || order.quantity <= 0) {
            throw new Error('quantity must be a positive integer');
        }
        if (order.type === 'limit') {
            if (order.price === undefined || !Number.isSafeInteger(order.price) || order.price <= 0) {
                throw new Error('limit order requires a positive integer price');
            }
        }
        if (this.index.has(order.id))
            throw new Error(`duplicate order id ${order.id}`);
        const opposite = order.side === 'buy' ? this.asks : this.bids;
        const fills = [];
        const stpCancelled = [];
        let remaining = order.quantity;
        while (remaining > 0) {
            const bestPrice = opposite.best();
            if (bestPrice === undefined)
                break;
            if (order.type === 'limit') {
                const crosses = order.side === 'buy' ? bestPrice <= order.price : bestPrice >= order.price;
                if (!crosses)
                    break;
            }
            const level = opposite.levels.get(bestPrice);
            while (remaining > 0) {
                const maker = level.peek();
                if (!maker)
                    break;
                if (maker.userId === order.userId) {
                    // self-trade prevention: cancel the resting order
                    stpCancelled.push({ ...maker });
                    level.total -= maker.remaining;
                    level.live -= 1;
                    maker.remaining = 0;
                    this.index.delete(maker.id);
                    continue;
                }
                const qty = Math.min(remaining, maker.remaining);
                maker.remaining -= qty;
                level.total -= qty;
                remaining -= qty;
                if (maker.remaining === 0) {
                    level.live -= 1;
                    this.index.delete(maker.id);
                }
                const buy = order.side === 'buy';
                fills.push({
                    price: maker.price,
                    quantity: qty,
                    makerOrderId: maker.id,
                    makerUserId: maker.userId,
                    takerOrderId: order.id,
                    takerUserId: order.userId,
                    buyOrderId: buy ? order.id : maker.id,
                    sellOrderId: buy ? maker.id : order.id,
                    buyerId: buy ? order.userId : maker.userId,
                    sellerId: buy ? maker.userId : order.userId,
                    makerRemaining: maker.remaining,
                });
            }
            if (level.total === 0)
                opposite.removeLevel(bestPrice);
        }
        let rested = false;
        if (remaining > 0 && order.type === 'limit') {
            this.rest({
                id: order.id,
                userId: order.userId,
                side: order.side,
                price: order.price,
                remaining,
            });
            rested = true;
        }
        return { fills, filled: order.quantity - remaining, remaining, rested, stpCancelled };
    }
    /** O(1) cancel. Returns the cancelled order (with its remaining qty) or undefined. */
    cancel(orderId) {
        const o = this.index.get(orderId);
        if (!o)
            return undefined;
        const side = o.side === 'buy' ? this.bids : this.asks;
        const level = side.levels.get(o.price);
        const snapshot = { ...o };
        level.total -= o.remaining;
        level.live -= 1;
        o.remaining = 0;
        this.index.delete(orderId);
        if (level.total === 0)
            side.removeLevel(o.price);
        return snapshot;
    }
    /**
     * How much would a market BUY of `quantity` cost right now?
     * Skips the buyer's own resting asks (self-trade prevention would cancel them).
     */
    estimateBuyCost(quantity, userId) {
        let need = quantity;
        let cost = 0;
        for (let i = this.asks.prices.length - 1; i >= 0 && need > 0; i--) {
            const lvl = this.asks.levels.get(this.asks.prices[i]);
            for (let j = lvl.head; j < lvl.orders.length && need > 0; j++) {
                const o = lvl.orders[j];
                if (o.remaining === 0 || o.userId === userId)
                    continue;
                const q = Math.min(need, o.remaining);
                cost += q * o.price;
                need -= q;
            }
        }
        return { cost, fillable: quantity - need };
    }
    snapshot(depth = 10) {
        return { symbol: this.symbol, bids: this.bids.depth(depth), asks: this.asks.depth(depth) };
    }
}
