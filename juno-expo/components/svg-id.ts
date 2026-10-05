import { useId } from "react";

/**
 * An SVG element id unique to this component instance.
 *
 * On the web every `<LinearGradient id>` lives in the page's one id space, so
 * two charts with the same gradient id paint with whichever definition came
 * first: a falling chart could fill with a rising one's colour. React's
 * `useId` keeps them apart; its colons are not allowed in a `url(#…)`.
 */
export function useSvgId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}
