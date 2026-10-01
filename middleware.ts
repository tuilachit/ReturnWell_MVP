import { NextResponse, type NextRequest } from "next/server";
import { securityHeaders } from "./app/lib/security-headers";
export function middleware(request: NextRequest) {
  const headers = securityHeaders({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    development: process.env.NODE_ENV === "development",
  });
  const forwarded = new Headers(request.headers);
  // Vinext reads this trusted request CSP to nonce SSR/RSC bootstrap scripts.
  // Always replace a client-supplied CSP rather than trusting its nonce.
  forwarded.set("content-security-policy", headers["content-security-policy"]);
  const response = NextResponse.next({ request: { headers: forwarded } });
  for (const [key, value] of Object.entries(headers))
    response.headers.set(key, value);
  return response;
}
export const config = {
  matcher: ["/((?!assets/|_next/|@vite/|@id/|node_modules/).*)"],
};
