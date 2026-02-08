export interface DiscordGuildResponse {
  approximate_member_count: number;
  approximate_presence_count: number;
  id: string;
  name: string;
}

export interface MemberStats {
  totalMembers: number;
  onlineMembers: number;
}

export interface Env {
  DISCORD_BOT_TOKEN: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  ALLOWED_ORIGIN?: string;
}