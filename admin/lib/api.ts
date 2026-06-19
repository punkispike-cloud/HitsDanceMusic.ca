/* Client API : attache le Bearer (access token en mémoire), tente une
   rotation /auth/refresh une seule fois au 401, puis rejoue la requête.
   Le refresh token vit dans un cookie httpOnly → credentials:"include". */

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8082";

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
let refreshing: Promise<boolean> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}
export function setOnUnauthorized(cb: (() => void) | null) {
  onUnauthorized = cb;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const r = await fetch(`${BASE}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!r.ok) return false;
        const data = await r.json();
        if (typeof data.accessToken === "string") {
          accessToken = data.accessToken;
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        // libère le verrou au tick suivant
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  retry?: boolean;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = "GET", body, retry = true } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, { ...opts, retry: false });
    onUnauthorized?.();
    throw new ApiError(401, "unauthorized", "Session expirée");
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? "error", err.message ?? "Erreur");
  }
  return data as T;
}

/** Télécharge un fichier authentifié (ex. export CSV) et déclenche la sauvegarde. */
async function download(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  let res = await fetch(`${BASE}${path}`, { headers, credentials: "include" });
  if (res.status === 401 && (await tryRefresh())) {
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    res = await fetch(`${BASE}${path}`, { headers, credentials: "include" });
  }
  if (!res.ok) throw new ApiError(res.status, "download_error", "Téléchargement impossible");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  download,
};

export const API_BASE = BASE;
