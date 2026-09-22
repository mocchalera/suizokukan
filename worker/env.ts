import type { DurableObjectNamespace, Fetcher } from '@cloudflare/workers-types';

export interface AppEnv {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace;
  BUDGET: DurableObjectNamespace;
  CF_VERSION_METADATA: { id: string; tag?: string; timestamp?: string };
  JEV_API_KEY?: string;
  JEV_MODEL: string;
  JEV_DAILY_LIMIT: string;
}
