const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getAccessToken() {
  return typeof window === "undefined"
    ? null
    : localStorage.getItem("go_access");
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem("go_access", access);
  localStorage.setItem("go_refresh", refresh);
}

export function clearTokens() {
  localStorage.removeItem("go_access");
  localStorage.removeItem("go_refresh");
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem("go_refresh");
  if (!refreshToken) return false;
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  setTokens(data.accessToken, data.refreshToken);
  return true;
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
  retried = false,
): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && !retried && (await tryRefresh())) {
    return api<T>(path, opts, true);
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message)
      ? data.message.join("; ")
      : (data?.message ?? res.statusText);
    throw new ApiError(res.status, msg);
  }
  return data as T;
}
