export const SYMBOLS = [
    { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy', refPrice: 285000 },
    { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT', refPrice: 410000 },
    { symbol: 'INFY', name: 'Infosys', sector: 'IT', refPrice: 165000 },
    { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking', refPrice: 172000 },
    { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'Banking', refPrice: 125000 },
    { symbol: 'ITC', name: 'ITC Limited', sector: 'FMCG', refPrice: 46000 },
];
export const SYMBOL_MAP = new Map(SYMBOLS.map((s) => [s.symbol, s]));
export const SYMBOL_CODES = SYMBOLS.map((s) => s.symbol);
export const TICK = 5; // 5 paise = INR 0.05 minimum price increment
