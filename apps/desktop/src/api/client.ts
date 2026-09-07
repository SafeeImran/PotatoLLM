/**
 * Thin typed fetch wrapper around Potato Core's loopback HTTP API. The UI
 * never talks to the core in any other way (no raw child-process calls, no
 * direct DB access) — see ARCHITECTURE.md.
 */

const CORE_PORT = 47823;
export const CORE_BASE_URL = `http://127.0.0.1:${CORE_PORT}`;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${CORE_BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError("Potato Core is not reachable. It may still be starting up.", 0);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ApiError(body || `Request to ${path} failed with ${response.status}`, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
