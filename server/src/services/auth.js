import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Account, RefreshToken, User } from '../models/index.js';
import { config, STARTING_CASH } from '../config.js';
import { ApiError } from '../errors.js';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export function signAccess(userId, role) {
    return jwt.sign({ sub: userId, role }, config.JWT_SECRET, { expiresIn: config.ACCESS_TTL_SECONDS, algorithm: 'HS256' });
}
export function verifyAccess(token) {
    try {
        const p = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
        return { id: String(p.sub), role: String(p.role) };
    }
    catch {
        throw new ApiError(401, 'INVALID_TOKEN', 'Invalid or expired token');
    }
}
async function issueTokens(userId, role) {
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    await RefreshToken.create({
        userId,
        tokenHash: sha(refreshToken), // never store the raw token
        expiresAt: new Date(Date.now() + config.REFRESH_TTL_SECONDS * 1000),
    });
    return { accessToken: signAccess(userId, role), refreshToken, expiresIn: config.ACCESS_TTL_SECONDS };
}
export async function register(email, password) {
    const passwordHash = await bcrypt.hash(password, 10);
    let user;
    try {
        user = await User.create({ email, passwordHash, role: 'user' });
    }
    catch (e) {
        if (e.code === 11000)
            throw new ApiError(409, 'EMAIL_TAKEN', 'Email already registered');
        throw e;
    }
    try {
        await Account.create({ userId: user._id, available: STARTING_CASH, locked: 0, initial: STARTING_CASH });
    }
    catch (e) {
        await User.deleteOne({ _id: user._id });
        throw e;
    }
    return { user: publicUser(user), ...(await issueTokens(String(user._id), user.role)) };
}
export async function login(email, password) {
    const user = await User.findOne({ email: email.toLowerCase() });
    // same error for unknown email and wrong password: don't reveal which accounts exist
    const ok = user && !user.isBot && (await bcrypt.compare(password, user.passwordHash));
    if (!user || !ok)
        throw new ApiError(401, 'BAD_CREDENTIALS', 'Invalid email or password');
    return { user: publicUser(user), ...(await issueTokens(String(user._id), user.role)) };
}
/** Refresh-token ROTATION: each refresh token works once; reuse = it's already gone. */
export async function refresh(refreshToken) {
    const doc = await RefreshToken.findOneAndDelete({ tokenHash: sha(refreshToken), expiresAt: { $gt: new Date() } });
    if (!doc)
        throw new ApiError(401, 'INVALID_REFRESH', 'Invalid or expired refresh token');
    const user = await User.findById(doc.userId);
    if (!user)
        throw new ApiError(401, 'INVALID_REFRESH', 'User no longer exists');
    return { user: publicUser(user), ...(await issueTokens(String(user._id), user.role)) };
}
export async function logout(refreshToken) {
    await RefreshToken.deleteOne({ tokenHash: sha(refreshToken) });
}
export function publicUser(u) {
    return { id: String(u._id), email: u.email, role: u.role };
}
