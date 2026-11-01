const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
/** paise (integer) -> "₹1,234.56" */
export const money = (paise) => (paise == null ? '—' : '₹' + inr.format(paise / 100));
/** paise -> "1,234.56" (no symbol, for tables) */
export const price = (paise) => (paise == null ? '—' : inr.format(paise / 100));
export const int = (n) => inr0.format(n);
export const pct = (n) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
export const signed = (paise) => `${paise > 0 ? '+' : paise < 0 ? '−' : ''}${money(Math.abs(paise))}`;
export const tone = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
/** "1234.56" (rupees typed by the user) -> 123456 paise, or null if invalid. Never uses float maths on money. */
export function rupeesToPaise(input) {
    const m = /^\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(input);
    if (!m)
        return null;
    return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
}
export const TICK = 5;
