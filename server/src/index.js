import http from 'node:http';
import mongoose from 'mongoose';
import { config, STARTING_CASH } from './config.js';
import { syncIndexes } from './models/index.js';
import { Exchange } from './services/exchange.js';
import { createApp } from './app.js';
import { attachSocket } from './ws/socket.js';
import { seed } from './services/seed.js';
import { Bots } from './services/bots.js';
async function main() {
    await mongoose.connect(config.MONGO_URI);
    console.log(`[db] connected (transactions ${config.MONGO_TRANSACTIONS ? 'ON' : 'OFF'})`);
    await syncIndexes();
    const { mmId, takerId } = await seed(STARTING_CASH);
    const exchange = new Exchange();
    await exchange.init();
    exchange.startBroadcasting();
    const app = createApp(exchange);
    const server = http.createServer(app);
    attachSocket(server, exchange);
    const bots = new Bots(exchange, mmId, takerId);
    if (config.BOTS_ENABLED)
        bots.start();
    server.listen(config.PORT, () => console.log(`[api] listening on :${config.PORT}  (bots: ${config.BOTS_ENABLED})`));
    const shutdown = async () => {
        console.log('[api] shutting down');
        bots.stop();
        exchange.stop();
        server.close();
        await mongoose.disconnect();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
