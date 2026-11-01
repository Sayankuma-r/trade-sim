/**
 * Event bus: fans updates out to WebSocket clients (see ws/socket.js).
 * Simple in-process version: exchange.js calls bus.publish(room, event, payload)
 * and the socket layer forwards it to everyone in that Socket.io room.
 */
class Bus {
  handlers = [];
  onMessage(h) {
    this.handlers.push(h);
  }
  publish(room, event, payload) {
    this.handlers.forEach((h) => h({ room, event, payload }));
  }
}
export const bus = new Bus();

/** Tiny in-memory cache with expiry (used so the same portfolio isn't sent to the AI twice). */
class Cache {
  mem = new Map();
  async get(key) {
    const e = this.mem.get(key);
    if (!e || e.exp < Date.now()) return null;
    return e.v;
  }
  async set(key, value, ttlSeconds) {
    this.mem.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
  }
}
export const cache = new Cache();
