import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/", "/login", "/register", "/reset-password"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  const token = request.cookies.get("accessToken")?.value;

  if (!isPublic && !token) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set(
      "redirect",
      `${pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons|fonts|manifest.json).*)",
  ],
};
