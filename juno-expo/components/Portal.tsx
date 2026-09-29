import {
  createContext,
  Fragment,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Render something at the root of the app rather than where it is written.
 *
 * A bottom sheet fills its parent. Written at a screen's root, the parent is
 * the screen and the sheet covers it; written inside a card on a scrolling page
 * — the Kuru limit order, a price alert, a weekly buy — the parent was the
 * card, so the sheet hung off the card's bottom edge mid-page, scrolled with
 * it, and had no backdrop over the rest of the screen. Hoisting it here makes
 * where a sheet is written and where it appears two separate questions.
 *
 * The host sits inside every provider the app has (wallet, Privy, theme, safe
 * area, gestures), so nothing a sheet reads from context is lost on the way.
 * Without a host — a sheet rendered above it — `Portal` renders in place.
 */

type Host = {
  set: (key: string, node: ReactNode) => void;
  remove: (key: string) => void;
};

const HostContext = createContext<Host | null>(null);

export function PortalHost({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<ReadonlyArray<readonly [string, ReactNode]>>([]);
  const host = useMemo<Host>(
    () => ({
      set: (key, node) =>
        setNodes((prev) => {
          const index = prev.findIndex(([existing]) => existing === key);
          if (index === -1) return [...prev, [key, node] as const];
          const next = prev.slice();
          next[index] = [key, node] as const;
          return next;
        }),
      remove: (key) => setNodes((prev) => prev.filter(([existing]) => existing !== key)),
    }),
    [],
  );

  return (
    <HostContext.Provider value={host}>
      {children}
      {nodes.map(([key, node]) => (
        <Fragment key={key}>{node}</Fragment>
      ))}
    </HostContext.Provider>
  );
}

export function Portal({ children }: { children: ReactNode }) {
  const host = useContext(HostContext);
  const key = useId();

  // Every render, because `children` is new every render. A layout effect, so
  // the hoisted copy is in place before paint — and before the sheet's own
  // (passive) effect starts the spring that animates it.
  useLayoutEffect(() => {
    host?.set(key, children);
  });
  useLayoutEffect(() => () => host?.remove(key), [host, key]);

  return host ? null : <>{children}</>;
}
