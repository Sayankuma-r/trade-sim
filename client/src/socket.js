import { io } from 'socket.io-client';
import { getAccessToken } from './api';
let socket = null;
/** One shared connection. `auth` is a function so reconnects always use the freshest access token. */
export function connectSocket() {
    if (socket)
        return socket;
    socket = io({ auth: (cb) => cb({ token: getAccessToken() }), transports: ['websocket', 'polling'] });
    return socket;
}
export function disconnectSocket() {
    socket?.disconnect();
    socket = null;
}
