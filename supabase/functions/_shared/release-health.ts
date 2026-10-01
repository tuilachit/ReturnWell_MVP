type Manifest = { protocol: number; sourceHash: string };
type HealthRuntime = {
  env: Record<string, string | undefined>;
  backendMigrations?: () => Promise<string[]>;
};
export function withReleaseHealth(
  endpoint: string, manifest: Manifest, runtime: HealthRuntime,
  next: (request: Request) => Promise<Response>,
) {
  return async (request: Request): Promise<Response> => {
    if (new URL(request.url).searchParams.get('release-health') !== '1') return next(request);
    const json = (body: unknown, status = 200) => Response.json(body, {
      status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    const key = runtime.env.BACKEND_RELEASE_CHECK_SECRET;
    if (!key || key.length < 32 || request.headers.get('authorization') !== `Bearer ${key}`) return json({ error: 'unauthorized' }, 401);
    try {
      const migrations = endpoint === 'workspace-access' ? await runtime.backendMigrations?.() : null;
      if (endpoint === 'workspace-access' && (!Array.isArray(migrations) || !migrations.length || migrations.some(x => !/^\d{14}$/.test(x)))) throw Error('history unavailable');
      return json({ protocol: manifest.protocol, endpoint, sourceHash: manifest.sourceHash, migrations });
    } catch { return json({ error: 'backend_unavailable' }, 503); }
  };
}
