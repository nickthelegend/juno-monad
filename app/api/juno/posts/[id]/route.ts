import { getPost, listPosts, replyCounts } from "@/lib/juno/posts";
import { getPool } from "@/lib/juno/registry";
import { hydratePool } from "@/lib/juno/chain";
import { identicon } from "@/lib/juno/identicon";
import { shortAddress } from "@/lib/juno/format";
import { mediaKind, mediaSrc } from "@/lib/juno/media";
import { junoError, junoJson, junoOptions, junoRead } from "@/lib/juno/api";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * One post, its replies, and the coin it is about.
 *
 * The coin is hydrated rather than echoed from the row, because a post arguing
 * for a market is worth very little next to a stale price. If that read fails
 * the post still returns — a throttled RPC should cost the price, not the
 * conversation.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return junoRead(async () => {
    const { id } = await params;

    const post = await getPost(id);
    if (!post) return junoError("Post not found", 404);

    const replies = await listPosts({ parentId: id, limit: 100 });

    const row = post.token ? await getPool(post.token) : null;
    // With history, because the card shows the day change and that is read
    // from trades — without it the change was always "—".
    const coin = row ? await hydratePool(row, { history: true }).catch(() => null) : null;

    const shape = (p: typeof post) => ({
      id: p.id,
      body: p.body,
      timestamp: p.createdAt.toISOString(),
      author: {
        wallet: p.authorWallet,
        handle: shortAddress(p.authorWallet, 4, 4),
        avatarUrl: identicon(p.authorWallet),
      },
      mediaUrl: mediaSrc(p.mediaUrl) ?? null,
      mediaKind: p.mediaMime ? mediaKind(p.mediaMime) : null,
    });

    return junoJson({
      post: shape(post),
      replies: replies.map(shape),
      replyCount: replies.length,
      coin: coin
        ? {
            address: coin.address,
            name: coin.name,
            symbol: coin.symbol,
            priceUsd: coin.priceUsd,
            marketCap: coin.marketCap,
            currency: coin.marketCapCurrency,
            changePct: coin.marketCapChangePct,
            progress: coin.curve.progress,
            graduated: coin.curve.graduated,
          }
        : null,
    });
  });
}
