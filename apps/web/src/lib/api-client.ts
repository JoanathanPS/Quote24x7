/**
 * Typed HTTP client for the Quote24x7 API.
 *
 * Today every route is a Next.js route handler serving seeded fixtures.
 * When the FastAPI backend ships, switch `NEXT_PUBLIC_API_BASE_URL` to its
 * origin and this client works unchanged — the route signatures are identical.
 */

const API_BASE = typeof window !== "undefined"
  ? (process.env.NEXT_PUBLIC_API_BASE_URL ?? "")
  : "";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * GET a JSON resource from the API.
 *
 * Params with `undefined` or empty-string values are silently omitted so
 * callers can pass filter objects directly without cleaning them first.
 */
export async function apiGet<T>(
  path: string,
  params?: Record<string, string | undefined>,
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    }
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "Unknown error");
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}
