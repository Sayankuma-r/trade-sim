export class ApiError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
const KEY = 'tradesim.tokens';
let tokens = null;
try {
    tokens = JSON.parse(localStorage.getItem(KEY) ?? 'null');
}
catch {
    tokens = null;
}
export const getAccessToken = () => tokens?.accessToken ?? '';
export function setTokens(t) {
    tokens = t;
    try {
        if (t)
            localStorage.setItem(KEY, JSON.stringify(t));
        else
            localStorage.removeItem(KEY);
    }
    catch {
        /* storage unavailable */
    }
}
export const hasTokens = () => tokens !== null;
let refreshing = null;
/** Single-flight refresh: many parallel 401s trigger ONE refresh call (tokens rotate, so a second would fail). */
function refreshTokens() {
    if (!tokens)
        return Promise.resolve(false);
    refreshing ?? (refreshing = (async () => {
        try {
            const res = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ refreshToken: tokens.refreshToken }),
            });
            if (!res.ok)
                throw new Error('refresh failed');
            const d = await res.json();
            setTokens({ accessToken: d.accessToken, refreshToken: d.refreshToken });
            return true;
        }
        catch {
            setTokens(null);
            window.dispatchEvent(new Event('tradesim:logout'));
            return false;
        }
        finally {
            refreshing = null;
        }
    })());
    return refreshing;
}
export async function api(path, opts = {}) {
    const doFetch = () => fetch('/api' + path, {
        method: opts.method ?? (opts.body ? 'POST' : 'GET'),
        headers: {
            ...(opts.body ? { 'content-type': 'application/json' } : {}),
            ...(opts.auth !== false && tokens ? { authorization: `Bearer ${tokens.accessToken}` } : {}),
            ...opts.headers,
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let res = await doFetch();
    if (res.status === 401 && opts.auth !== false && (await refreshTokens()))
        res = await doFetch();
    if (res.status === 204)
        return undefined;
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
        throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Request failed');
    return data;
}
/**
 * Place an order. The Idempotency-Key is generated ONCE per user action and re-sent on
 * automatic retries after a network failure: if the first request actually reached the
 * server, the retry returns the same order instead of creating a duplicate.
 */
export async function placeOrder(body) {
    const key = crypto.randomUUID();
    for (let attempt = 0;; attempt++) {
        try {
            return await api('/orders', { method: 'POST', body, headers: { 'Idempotency-Key': key } });
        }
        catch (e) {
            const network = e instanceof TypeError; // fetch() rejects with TypeError on network failure
            if (!network || attempt >= 2)
                throw e;
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
    }
}
