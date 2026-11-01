import { SYMBOL_CODES, TICK } from './symbols.js';
import { ApiError } from './errors.js';

const bad = (message) => new ApiError(400, 'VALIDATION', message);
const isInt = (n) => Number.isInteger(n);

export function validateCredentials(body = {}) {
  const { email, password } = body;
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw bad('A valid email is required');
  if (typeof password !== 'string' || password.length < 8 || password.length > 100) throw bad('Password must be 8-100 characters');
  return { email, password };
}

export function validateRefreshToken(body = {}) {
  if (typeof body.refreshToken !== 'string' || body.refreshToken.length < 10) throw bad('refreshToken is required');
  return body.refreshToken;
}

/** price is an integer in PAISE and a multiple of the tick size. */
export function validateOrder(body = {}) {
  const { symbol, side, type, price, quantity } = body;
  if (!SYMBOL_CODES.includes(symbol)) throw bad('Unknown symbol');
  if (!['buy', 'sell'].includes(side)) throw bad('side must be buy or sell');
  if (!['limit', 'market'].includes(type)) throw bad('type must be limit or market');
  if (!isInt(quantity) || quantity <= 0 || quantity > 100_000) throw bad('quantity must be a whole number between 1 and 100000');
  if (type === 'limit') {
    if (price === undefined) throw bad('price is required for limit orders');
    if (!isInt(price) || price <= 0 || price > 10_000_000 || price % TICK !== 0) throw bad(`price must be a positive whole number of paise, a multiple of ${TICK}`);
  } else if (price !== undefined) {
    throw bad('market orders must not have a price');
  }
  return { symbol, side, type, price, quantity };
}
