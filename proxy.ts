import { NextResponse, type NextRequest } from "next/server";

/**
 * This server is Juno's API. Its pages are not the product — the Expo app is,
 * and its web build lives at `JUNO_APP_URL`.
 *
 * So every page request is sent to the app, at the matching screen where there
 * is one: a shared coin link opens the coin, a creator link opens the trader.
 * `/api/*` is untouched — it is what the app calls. Without `JUNO_APP_URL` the
 * server answers its own small status page at `/`.
 */
function appRedirect(req: NextRequest): NextResponse | null {
  const app = process.env.JUNO_APP_URL?.replace(/\/$/, "");
  const { pathname } = req.nextUrl;
  if (!app || pathname.startsWith("/api/")) return null;

  const coin = /^\/coin\/(0x[0-9a-fA-F]{40})$/.exec(pathname);
  const creator = /^\/(?:creator|trader)\/(0x[0-9a-fA-F]{40})$/.exec(pathname);
  const target = coin
    ? `/coin/${coin[1]}`
    : creator
      ? `/trader/${creator[1]}`
      : pathname === "/reels"
        ? "/reels"
        : "/";
  return NextResponse.redirect(`${app}${target}`, 307);
}

export default function proxy(req: NextRequest) {
  return appRedirect(req) ?? NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|api/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ico|webmanifest)).*)"],
};
