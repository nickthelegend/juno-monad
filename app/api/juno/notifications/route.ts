import { junoHandler, junoJson, junoOptions, junoRead, readJson, requireString } from "@/lib/juno/api";
import { loadInbox, markInboxSeen } from "@/lib/juno/inbox-load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `GET /notifications?wallet=` — the wallet's inbox, newest first, with how
 * many items are newer than its last visit. See `lib/juno/inbox.ts` for
 * what counts as a notification.
 */
export async function GET(request: Request) {
  return junoRead(async () => {
    const wallet = requireString(new URL(request.url).searchParams.get("wallet"), "wallet");
    return junoJson(await loadInbox(wallet));
  });
}

/**
 * `POST /notifications {wallet}` — the inbox was opened: everything in it is
 * read. Unsigned, like a follow or a like: it changes nothing but a badge.
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    return junoJson(await markInboxSeen(requireString(body.wallet, "wallet")));
  });
}
