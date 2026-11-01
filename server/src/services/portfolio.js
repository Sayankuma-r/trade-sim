import { Types } from 'mongoose';
import { Account, Position } from '../models/index.js';
import { SYMBOL_MAP } from '../symbols.js';
import { STARTING_CASH } from '../config.js';
const round2 = (n) => Math.round(n * 100) / 100;
/** Standard deviation of simple returns between consecutive trade prices, in percent. */
export function volatilityPct(prices) {
    if (prices.length < 3)
        return 0;
    const rets = [];
    for (let i = 1; i < prices.length; i++)
        rets.push(prices[i] / prices[i - 1] - 1);
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
    return round2(Math.sqrt(variance) * 100);
}
/**
 * Pure, deterministic portfolio maths. The LLM is only ever given THIS output to
 * explain, never raw data to calculate with (LLMs make arithmetic mistakes).
 */
export function computePortfolio(args) {
    const held = args.holdings.filter((h) => h.quantity > 0);
    const rows = held.map((h) => {
        const info = SYMBOL_MAP.get(h.symbol);
        const last = args.prices.get(h.symbol) ?? info?.refPrice ?? 0;
        const marketValue = last * h.quantity;
        const unrealized = marketValue - h.costBasis;
        return {
            symbol: h.symbol,
            name: info?.name ?? h.symbol,
            sector: info?.sector ?? 'Other',
            quantity: h.quantity,
            avgPrice: Math.round(h.costBasis / h.quantity),
            lastPrice: last,
            marketValue,
            unrealizedPnl: unrealized,
            unrealizedPnlPct: h.costBasis ? round2((unrealized / h.costBasis) * 100) : 0,
            vol: volatilityPct(args.history.get(h.symbol) ?? []),
        };
    });
    const positionsValue = rows.reduce((a, r) => a + r.marketValue, 0);
    const holdings = rows.map((r) => ({
        symbol: r.symbol,
        name: r.name,
        sector: r.sector,
        quantity: r.quantity,
        avgPrice: r.avgPrice,
        lastPrice: r.lastPrice,
        marketValue: r.marketValue,
        unrealizedPnl: r.unrealizedPnl,
        unrealizedPnlPct: r.unrealizedPnlPct,
        weightPct: positionsValue ? round2((r.marketValue / positionsValue) * 100) : 0,
        volatilityPct: r.vol,
    }));
    holdings.sort((a, b) => b.marketValue - a.marketValue);
    const sectorMap = new Map();
    for (const h of holdings)
        sectorMap.set(h.sector, (sectorMap.get(h.sector) ?? 0) + h.marketValue);
    const sectors = [...sectorMap.entries()]
        .map(([sector, v]) => ({ sector, weightPct: positionsValue ? round2((v / positionsValue) * 100) : 0 }))
        .sort((a, b) => b.weightPct - a.weightPct);
    const hhi = round2(holdings.reduce((a, h) => a + (h.weightPct / 100) ** 2, 0));
    const topPositionPct = holdings[0]?.weightPct ?? 0;
    const topSectorPct = sectors[0]?.weightPct ?? 0;
    // portfolio volatility ≈ sqrt(Σ w²σ²): assumes zero correlation, so it's an optimistic estimate
    const estimatedVolatilityPct = round2(Math.sqrt(holdings.reduce((a, h) => a + ((h.weightPct / 100) * h.volatilityPct) ** 2, 0)));
    let riskLevel = 'none';
    if (holdings.length) {
        riskLevel = topPositionPct > 50 || topSectorPct > 70 ? 'high' : topPositionPct > 30 || topSectorPct > 50 ? 'medium' : 'low';
    }
    const equity = args.cash + args.lockedCash + positionsValue;
    const realizedPnl = args.holdings.reduce((a, h) => a + h.realizedPnl, 0);
    return {
        cash: args.cash,
        lockedCash: args.lockedCash,
        positionsValue,
        equity,
        startingEquity: STARTING_CASH,
        totalReturnPct: round2(((equity - STARTING_CASH) / STARTING_CASH) * 100),
        realizedPnl,
        unrealizedPnl: holdings.reduce((a, h) => a + h.unrealizedPnl, 0),
        holdings,
        sectors,
        concentration: { topPositionPct, topSectorPct, hhi },
        estimatedVolatilityPct,
        riskLevel,
    };
}
export async function loadPortfolio(userId, exchange) {
    const uid = new Types.ObjectId(userId);
    const [acct, positions] = await Promise.all([Account.findOne({ userId: uid }).lean(), Position.find({ userId: uid }).lean()]);
    return computePortfolio({
        cash: acct?.available ?? 0,
        lockedCash: acct?.locked ?? 0,
        holdings: positions.map((p) => ({
            symbol: p.symbol,
            quantity: p.quantity + p.lockedQuantity,
            costBasis: p.costBasis,
            realizedPnl: p.realizedPnl,
        })),
        prices: exchange.lastPrice,
        history: exchange.history,
    });
}
