import { Redis } from '@upstash/redis/cloudflare';
import { rateLimit, getClientIp } from './lib/rateLimit';
import type { Env, DiscordGuildResponse, MemberStats } from './types/discord';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only allow GET requests
    if (request.method !== 'GET') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: corsHeaders }
      );
    }

    try {
      // Initialize Redis
      const redis = new Redis({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
      });

      // Get client IP and apply rate limiting
      const clientIp = getClientIp(request);
      const rateLimitResult = await rateLimit(redis, clientIp, 10, 60000);

      const headers = {
        ...corsHeaders,
        'X-RateLimit-Limit': rateLimitResult.limit.toString(),
        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
        'X-RateLimit-Reset': new Date(rateLimitResult.reset).toISOString(),
      };

      // Check rate limit
      if (!rateLimitResult.success) {
        return new Response(
          JSON.stringify({
            error: 'Rate limit exceeded. Please try again later.',
            retryAfter: Math.ceil((rateLimitResult.reset - Date.now()) / 1000),
          }),
          {
            status: 429,
            headers: {
              ...headers,
              'Retry-After': Math.ceil((rateLimitResult.reset - Date.now()) / 1000).toString(),
            },
          }
        );
      }

      // Parse URL and get guild ID
      const url = new URL(request.url);
      const guildId = url.searchParams.get('guildId');

      if (!guildId) {
        return new Response(
          JSON.stringify({ error: 'Guild ID is required' }),
          { status: 400, headers }
        );
      }

      // Validate bot token
      if (!env.DISCORD_BOT_TOKEN) {
        return new Response(
          JSON.stringify({ error: 'Missing bot token configuration' }),
          { status: 500, headers }
        );
      }

      // Fetch Discord data
      const discordResponse = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}?with_counts=true`,
        {
          headers: {
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          },
        }
      );

      if (!discordResponse.ok) {
        if (discordResponse.status === 404) {
          return new Response(
            JSON.stringify({ error: 'Guild not found or bot not in server' }),
            { status: 404, headers }
          );
        }
        if (discordResponse.status === 403) {
          return new Response(
            JSON.stringify({ error: 'Bot does not have permission to access this server' }),
            { status: 403, headers }
          );
        }
        throw new Error('Failed to fetch Discord data');
      }

      const data: DiscordGuildResponse = await discordResponse.json();

      const stats: MemberStats = {
        totalMembers: data.approximate_member_count,
        onlineMembers: data.approximate_presence_count,
      };

      return new Response(JSON.stringify(stats), { headers });
    } catch (error) {
      console.error('Discord API error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch member counts' }),
        { status: 500, headers: corsHeaders }
      );
    }
  },
};