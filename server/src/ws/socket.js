import { Server } from 'socket.io';
import { config } from '../config.js';
import { verifyAccess } from '../services/auth.js';
import { bus } from '../services/bus.js';
import { SYMBOL_MAP } from '../symbols.js';
/**
 * Rooms:
 *   ticker            every connection: last prices of all symbols (1/sec)
 *   symbol:<SYMBOL>   opt-in: order-book depth (<=10/sec) and trades for ONE symbol
 *   user:<id>         private: "refresh" hints when your orders/cash/shares changed
 * Auth: JWT in the Socket.IO handshake (`auth: { token }`).
 */
export function attachSocket(http, exchange) {
    const io = new Server(http, { cors: { origin: config.CLIENT_ORIGIN.split(',') } });
    io.use((socket, next) => {
        try {
            const token = socket.handshake.auth?.token;
            if (!token)
                return next(new Error('NO_TOKEN'));
            socket.data.user = verifyAccess(token);
            next();
        }
        catch {
            next(new Error('INVALID_TOKEN'));
        }
    });
    io.on('connection', (socket) => {
        const user = socket.data.user;
        socket.join('ticker');
        socket.join(`user:${user.id}`);
        socket.emit('ticker', exchange.getTicker());
        socket.on('subscribe', (symbol) => {
            if (typeof symbol !== 'string' || !SYMBOL_MAP.has(symbol))
                return;
            // a socket watches one symbol at a time
            for (const room of socket.rooms)
                if (room.startsWith('symbol:'))
                    socket.leave(room);
            socket.join(`symbol:${symbol}`);
            socket.emit('book', exchange.getBook(symbol, 12));
        });
    });
    // every message from the bus (local or via Redis) is pushed to the right room
    bus.onMessage(({ room, event, payload }) => io.to(room).emit(event, payload));
    return io;
}
