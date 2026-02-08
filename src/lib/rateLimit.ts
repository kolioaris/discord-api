import { Redis } from '@upstash/redis/cloudflare';

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

export async function rateLimit(
  redis: Redis,
  identifier: string,
  limit: number = 10,
  windowMs: number = 60000
): Promise<RateLimitResult> {
  const key = `ratelimit:${identifier}`;
  const now = Date.now();
  const windowStart = now - windowMs;

  try {
    // Remove old requests
    await redis.zremrangebyscore(key, 0, windowStart);
    
    // Get current count
    const requestCount = await redis.zcard(key);

    if (requestCount >= limit) {
      // Rate limit exceeded
      const oldestRequest = await redis.zrange(key, 0, 0, { withScores: true });
      const resetTime = oldestRequest[0]?.score 
        ? (oldestRequest[0].score as number) + windowMs 
        : now + windowMs;

      return {
        success: false,
        limit,
        remaining: 0,
        reset: resetTime,
      };
    }

    // Add current request
    await redis.zadd(key, { score: now, member: `${now}-${Math.random()}` });
    
    // Set expiry
    await redis.expire(key, Math.ceil(windowMs / 1000));

    return {
      success: true,
      limit,
      remaining: limit - (requestCount + 1),
      reset: now + windowMs,
    };
  } catch (error) {
    console.error('Rate limit error:', error);
    // Fail open
    return {
      success: true,
      limit,
      remaining: limit,
      reset: now + windowMs,
    };
  }
}

export function getClientIp(request: Request): string {
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  const xForwardedFor = request.headers.get('x-forwarded-for');
  const xRealIp = request.headers.get('x-real-ip');

  if (cfConnectingIp) return cfConnectingIp;
  if (xRealIp) return xRealIp;
  if (xForwardedFor) return xForwardedFor.split(',')[0].trim();

  return 'unknown';
}