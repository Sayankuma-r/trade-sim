import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
export function useConnection(socket) {
    const [connected, setConnected] = useState(socket.connected);
    useEffect(() => {
        const on = () => setConnected(true);
        const off = () => setConnected(false);
        socket.on('connect', on);
        socket.on('disconnect', off);
        return () => {
            socket.off('connect', on);
            socket.off('disconnect', off);
        };
    }, [socket]);
    return connected;
}
export function useTickers(socket) {
    const [tickers, setTickers] = useState([]);
    useEffect(() => {
        api('/market/symbols', { auth: false }).then(setTickers).catch(() => undefined);
        socket.on('ticker', setTickers);
        return () => void socket.off('ticker', setTickers);
    }, [socket]);
    return tickers;
}
/** Order book + trade tape for ONE symbol, kept live over the socket. */
export function useSymbolFeed(socket, symbol) {
    const [book, setBook] = useState(null);
    const [trades, setTrades] = useState([]);
    useEffect(() => {
        let alive = true;
        setBook(null);
        setTrades([]);
        const subscribe = () => socket.emit('subscribe', symbol);
        subscribe();
        socket.on('connect', subscribe); // re-subscribe after a reconnect
        api(`/market/${symbol}/book?depth=12`, { auth: false }).then((b) => alive && setBook((cur) => cur ?? b)).catch(() => undefined);
        api(`/market/${symbol}/trades?limit=200`, { auth: false })
            .then((t) => alive && setTrades((cur) => (cur.length ? cur : [...t].reverse())))
            .catch(() => undefined);
        const onBook = (b) => b.symbol === symbol && setBook(b);
        const onTrade = (t) => {
            if (t.symbol !== symbol)
                return;
            setTrades((cur) => [...cur.slice(-199), { price: t.price, quantity: t.quantity, ts: t.ts }]);
        };
        socket.on('book', onBook);
        socket.on('trade', onTrade);
        return () => {
            alive = false;
            socket.off('connect', subscribe);
            socket.off('book', onBook);
            socket.off('trade', onTrade);
        };
    }, [socket, symbol]);
    return { book, trades };
}
/** The user's own portfolio + orders. The server pushes a `refresh` hint whenever something changed. */
export function useAccount(socket) {
    const [portfolio, setPortfolio] = useState(null);
    const [orders, setOrders] = useState([]);
    const timer = useRef(undefined);
    const reload = useCallback(async () => {
        const [p, o] = await Promise.all([api('/portfolio'), api('/orders')]);
        setPortfolio(p);
        setOrders(o);
    }, []);
    useEffect(() => {
        reload().catch(() => undefined);
        const onRefresh = () => {
            window.clearTimeout(timer.current); // debounce bursts of fills into one refetch
            timer.current = window.setTimeout(() => reload().catch(() => undefined), 250);
        };
        socket.on('refresh', onRefresh);
        // marks prices to market even when nothing of yours changed
        const poll = window.setInterval(() => reload().catch(() => undefined), 10000);
        return () => {
            socket.off('refresh', onRefresh);
            window.clearInterval(poll);
            window.clearTimeout(timer.current);
        };
    }, [socket, reload]);
    return { portfolio, orders, reload };
}
