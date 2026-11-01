import express from 'express';
import cors from 'cors';
import { buildRouter } from './routes/api.js';
import { ApiError } from './errors.js';
import { config } from './config.js';
export function createApp(exchange) {
    const app = express();
    app.set('trust proxy', 1);
    app.use(cors({ origin: config.CLIENT_ORIGIN.split(','), exposedHeaders: ['Idempotent-Replay'] }));
    app.use(express.json({ limit: '10kb' }));
    app.use('/api', buildRouter(exchange));
    app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Route not found')));
    app.use((err, _req, res, _next) => {
        if (err instanceof ApiError) {
            return res.status(err.status).json({ error: { code: err.code, message: err.message } });
        }
        if (err.type === 'entity.parse.failed') {
            return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON' } });
        }
        console.error(err);
        res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
    });
    return app;
}
