import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: sends visitors without a session cookie to /login.
// Every page and action still verifies the session against the database.
const SESSION_COOKIE = "adr_session";

export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
