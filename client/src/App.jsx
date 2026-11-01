import { useCallback, useEffect, useState } from 'react';
import { api, hasTokens, setTokens } from './api';
import { connectSocket, disconnectSocket } from './socket';
import AuthPage from './components/AuthPage';
import Trading from './Trading';
export default function App() {
    const [user, setUser] = useState(null);
    const [booting, setBooting] = useState(hasTokens());
    useEffect(() => {
        if (!hasTokens())
            return;
        api('/auth/me')
            .then(setUser)
            .catch(() => setTokens(null))
            .finally(() => setBooting(false));
    }, []);
    const logout = useCallback(async () => {
        const raw = localStorage.getItem('tradesim.tokens');
        const refreshToken = raw ? JSON.parse(raw).refreshToken : null;
        if (refreshToken)
            await api('/auth/logout', { method: 'POST', body: { refreshToken }, auth: false }).catch(() => undefined);
        setTokens(null);
        disconnectSocket();
        setUser(null);
    }, []);
    // the API layer fires this when a refresh token is rejected (session truly expired)
    useEffect(() => {
        const onLogout = () => {
            disconnectSocket();
            setUser(null);
        };
        window.addEventListener('tradesim:logout', onLogout);
        return () => window.removeEventListener('tradesim:logout', onLogout);
    }, []);
    if (booting)
        return <div className="boot">Loading…</div>;
    if (!user)
        return <AuthPage onAuth={setUser}/>;
    return <Trading user={user} socket={connectSocket()} onLogout={logout}/>;
}
