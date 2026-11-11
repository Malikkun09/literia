import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export type Surface = "admin" | "member";

function resolveSurface(host: string): Surface {
  const adminHost = (process.env.ADMIN_APP_URL ?? "").replace(/^https?:\/\//, "").split("/")[0];
  const memberHost = (process.env.APP_URL ?? "").replace(/^https?:\/\//, "").split("/")[0];
  if (adminHost && host === adminHost) return "admin";
  if (memberHost && host === memberHost) return "member";
  if (host.startsWith("admin.") || host.startsWith("admin-")) return "admin";
  return "member";
}

const PROTECTED_ADMIN = ["/documents", "/users", "/reports", "/categories", "/storage", "/settings", "/audit"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host") ?? "";
  const surface = resolveSurface(host);

  const hasSession = Boolean(getSessionCookie(request));

  const isMemberArea =
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/upload" ||
    pathname.startsWith("/upload/") ||
    (pathname.startsWith("/dokumen/") && pathname.endsWith("/baca"));
  if (surface === "member" && isMemberArea && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const needsAdmin = surface === "member"
    ? PROTECTED_ADMIN.some((p) => pathname === p || pathname.startsWith(`${p}/`))
    : false;
  if (needsAdmin) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const response = NextResponse.next();
  response.headers.set("x-literia-surface", surface);
  response.headers.set("x-literia-host", host);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth|api/health).*)"],
};
