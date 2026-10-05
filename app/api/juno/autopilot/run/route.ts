import { CallerError, junoHandler, junoJson } from "@/lib/juno/api";
import { runDuePlans } from "@/lib/juno/autopilot";
import { localFork } from "@/lib/juno/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST` with `Authorization: Bearer $JUNO_CRON_SECRET` — buy every due plan
 * of every wallet on autopilot. Run by the cron beside the log tail. On a
 * local fork with no secret set it needs none.
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const secret = process.env.JUNO_CRON_SECRET?.trim();
    const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (secret ? given !== secret : !localFork()) throw new CallerError("Not allowed", 401);
    return junoJson({ runs: await runDuePlans() });
  });
}
