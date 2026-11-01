import { verifyAccess } from '../services/auth.js';
import { ApiError } from '../errors.js';
export function requireAuth(req, _res, next) {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer '))
        return next(new ApiError(401, 'NO_TOKEN', 'Missing bearer token'));
    try {
        req.user = verifyAccess(h.slice(7));
        next();
    }
    catch (e) {
        next(e);
    }
}
/** Role-based access control. */
export const requireRole = (role) => (req, _res, next) => req.user?.role === role ? next() : next(new ApiError(403, 'FORBIDDEN', 'Insufficient permissions'));
