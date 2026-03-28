const DEFAULT_API_URL = 'https://api.useautumn.com';

function getConfig() {
  const secretKey = process.env.AUTUMN_SECRET_KEY;
  if (!secretKey) throw new Error('AUTUMN_SECRET_KEY environment variable is required');
  const apiUrl = process.env.AUTUMN_API_URL || DEFAULT_API_URL;
  return { secretKey, apiUrl };
}

interface FetchOptions {
  method: 'GET' | 'POST';
  path: string;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
}

export async function autumnFetch<T>(options: FetchOptions): Promise<T> {
  const { secretKey, apiUrl } = getConfig();
  const url = new URL(options.path, apiUrl);

  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    method: options.method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Autumn API ${options.method} ${options.path}: ${response.status} ${response.statusText}${text ? ` — ${text}` : ''}`);
  }

  return response.json() as Promise<T>;
}
