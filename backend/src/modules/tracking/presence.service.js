import { env } from '../../config/env.js';
import { getRedis, redisEnabled } from '../../lib/redis.js';
const key = (tenantId, userId) => `${env.REDIS_KEY_PREFIX}presence:${tenantId}:${userId}`;
const cutoff = () => Date.now() - env.SOCKET_PRESENCE_TTL_SECONDS * 1_000;
const pruneAndCount = async (tenantId, userId) => {
    const redis = getRedis();
    const presenceKey = key(tenantId, userId);
    await redis.zRemRangeByScore(presenceKey, 0, cutoff());
    return redis.zCard(presenceKey);
};
export const touchPresence = async (tenantId, userId, socketId) => {
    if (!redisEnabled())
        return;
    const presenceKey = key(tenantId, userId);
    await getRedis().multi()
        .zAdd(presenceKey, { score: Date.now(), value: socketId })
        .zRemRangeByScore(presenceKey, 0, cutoff())
        .expire(presenceKey, env.SOCKET_PRESENCE_TTL_SECONDS * 2)
        .exec();
};
export const removePresence = async (tenantId, userId, socketId) => {
    if (!redisEnabled())
        return false;
    await getRedis().zRem(key(tenantId, userId), socketId);
    return (await pruneAndCount(tenantId, userId)) > 0;
};
export const isUserPresent = async (tenantId, userId) => {
    if (!redisEnabled())
        return false;
    return (await pruneAndCount(tenantId, userId)) > 0;
};
export const getPresentUsers = async (tenantId, userIds) => {
    if (!redisEnabled() || userIds.length === 0)
        return new Set();
    const counts = await Promise.all(userIds.map((userId) => pruneAndCount(tenantId, userId)));
    return new Set(userIds.filter((_userId, index) => counts[index] > 0));
};
