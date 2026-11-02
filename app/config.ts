import { fail } from './db.js';
export type Config = {
  origin: string; basePath: string; apiKey?: string; model: string;
  dailyCalls: number; staleDays: number; maxCandidates: number; setupToken?: string;
};
export function configuration(env: Record<string, string | undefined>): Config {
  const url = new URL(env.PUBLIC_ORIGIN || 'http://127.0.0.1:4319');
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail(500, 'PUBLIC_ORIGIN must be an origin without a path');
  const basePath = (env.BASE_PATH ?? '/associated-sales').replace(/\/$/, '');
  if (basePath && !/^(\/[a-zA-Z0-9_-]+)+$/.test(basePath)) fail(500, 'Invalid BASE_PATH');
  const number = (key: string, fallback: number, max: number) => {
    const n = Number(env[key] ?? fallback);
    if (!Number.isInteger(n) || n < 1 || n > max) fail(500, `Invalid ${key}`);
    return n;
  };
  return { origin:url.origin, basePath, apiKey:env.OPENAI_API_KEY, model:env.OPENAI_MODEL || 'gpt-4.1-2025-04-14', dailyCalls:number('MAX_MODEL_CALLS_PER_DAY',20,1000), staleDays:number('INVENTORY_MAX_AGE_DAYS',30,365), maxCandidates:number('MAX_CATALOG_CANDIDATES',80,100), setupToken:env.SETUP_TOKEN };
}
export const pathFor = (config: Config, path: string) => config.basePath + (path.startsWith('/') ? path : '/' + path);
