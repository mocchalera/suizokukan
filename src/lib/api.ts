export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const timeout = AbortSignal.timeout(10000);
  const response = await fetch(path, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'つながりませんでした。もう一度おためしください。');
  return body;
}
export const messageOf = (error: unknown) => error instanceof Error ? error.message : 'うまくできませんでした。もう一度おためしください。';
