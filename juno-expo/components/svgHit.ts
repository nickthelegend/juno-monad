import { Platform } from "react-native";

/**
 * Handlers for an SVG shape that should respond to a touch, on every platform.
 *
 * On a phone, react-native-svg turns `onPressIn` into a touch responder. On
 * the web it does the same and hands the responder's props
 * (`onStartShouldSetResponder`, `onResponderGrant`…) to the DOM `<rect>`,
 * which React rejects with a console error for each one and never calls. The
 * web gets the pointer events a DOM element understands instead: a press, and
 * a hover so a mouse can scrub the chart without clicking.
 */
export function svgHit(onHit: () => void): object {
  return Platform.OS === "web"
    ? { onPointerDown: onHit, onPointerEnter: onHit }
    : { onPressIn: onHit };
}
