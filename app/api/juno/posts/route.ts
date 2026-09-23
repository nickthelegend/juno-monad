import { createPost, listPosts } from "@/lib/juno/posts";
import { assertAddress } from "@/lib/juno/social-graph";
import {
  CallerError,
  junoHandler,
  junoJson,
  junoOptions,
  readJson,
  requireString,
} from "@/lib/juno/api";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `GET ?limit&before&author=&token=` — top-level posts, newest first.
 *
 * `author` and `token` are addresses and are checksummed before the query,
 * because that is how they were stored: a lowercase address from a URL must
 * find the same rows as a checksummed one.
 */
export async function GET(request: Request) {
  return junoHandler(async () => {
    const url = new URL(request.url);
    const before = url.searchParams.get("before");
    const beforeDate = before ? new Date(before) : undefined;
    if (beforeDate && Number.isNaN(beforeDate.getTime())) {
      throw new CallerError('"before" must be a date');
    }
    const author = url.searchParams.get("author");
    const token = url.searchParams.get("token");
    const posts = await listPosts({
      limit: Number(url.searchParams.get("limit") ?? 30) || 30,
      before: beforeDate,
      authorWallet: author ? assertAddress(author, "author") : undefined,
      token: token ? assertAddress(token, "token") : undefined,
    });
    return junoJson({ posts });
  });
}

/**
 * Write a post: `POST {author, body, token?, parentId?, mediaUrl?, mediaMime?}`.
 *
 * The author is whatever wallet the client says it is. That is deliberate and
 * worth being explicit about: a post is public, unprivileged text, and nothing
 * here spends money or reads anything private. Attributing one to the wrong
 * wallet is the limit of the damage, and gating it behind a signature would
 * mean a wallet prompt to write a sentence.
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);

    const post = await createPost({
      authorWallet: requireString(body.author, "author"),
      /*
       * Not truncated here.
       *
       * Slicing to the limit made an over-length post return 201 having
       * silently thrown away the tail — the author was told it worked and the
       * end of what they wrote was gone. `createPost` rejects it instead, so
       * the caller finds out.
       */
      body: requireString(body.body, "body"),
      token: typeof body.token === "string" && body.token.trim() ? body.token.trim() : null,
      mediaUrl: typeof body.mediaUrl === "string" ? body.mediaUrl : null,
      mediaMime: typeof body.mediaMime === "string" ? body.mediaMime : null,
      parentId: typeof body.parentId === "string" ? body.parentId : null,
    });

    return junoJson({ post }, { status: 201 });
  });
}
