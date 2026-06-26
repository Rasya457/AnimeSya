/**
 * server-fetch.ts
 * A thin fetch wrapper for Server Components that forwards the session
 * cookie from the incoming request to the Laravel backend, keeping auth
 * fully httpOnly without exposing tokens to the client.
 */

import { cookies } from "next/headers";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function serverFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("animesya_session")?.value;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (sessionCookie) {
    headers["Cookie"] = `animesya_session=${sessionCookie}`;
  }

  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers,
    cache: options.cache ?? "no-store",
  });

  if (!res.ok) {
    throw new Error(`serverFetch error ${res.status}: ${path}`);
  }

  return res.json() as Promise<T>;
}
