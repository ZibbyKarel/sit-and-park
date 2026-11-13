/** Pure view maths for the floor plan. Coordinates are viewBox (plan) units. */
export interface View {
  scale: number;
  tx: number;
  ty: number;
}

export const IDENTITY_VIEW: View = { scale: 1, tx: 0, ty: 0 };
export const MIN_SCALE = 1;
export const MAX_SCALE = 12;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Keeps the scaled plan covering the visible window (`width` x `height`, plan units), so it
 * cannot be dragged out of sight. The plan is `planWidth` x `planHeight`; it defaults to the
 * window, and is larger than it when the default view covers the shorter axis.
 */
function clampView(
  view: View,
  width: number,
  height: number,
  planWidth: number,
  planHeight: number
): View {
  return {
    scale: view.scale,
    tx: clamp(view.tx, width - planWidth * view.scale, 0),
    ty: clamp(view.ty, height - planHeight * view.scale, 0),
  };
}

/** Multiplies the scale by `factor`, keeping the viewport point (cx, cy) fixed. */
export function zoomAt(
  view: View,
  factor: number,
  cx: number,
  cy: number,
  width: number,
  height: number,
  planWidth = width,
  planHeight = height
): View {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  const ratio = scale / view.scale;
  return clampView(
    { scale, tx: cx - (cx - view.tx) * ratio, ty: cy - (cy - view.ty) * ratio },
    width,
    height,
    planWidth,
    planHeight
  );
}

export function panBy(
  view: View,
  dx: number,
  dy: number,
  width: number,
  height: number,
  planWidth = width,
  planHeight = height
): View {
  return clampView(
    { ...view, tx: view.tx + dx, ty: view.ty + dy },
    width,
    height,
    planWidth,
    planHeight
  );
}

const LINE_PX = 16;
const WHEEL_ZOOM_STEP = 1.15;
const WHEEL_ZOOM_STEP_DELTA = 100;

/** Wheel delta -> pixels (`deltaMode`: 0 pixels, 1 lines, 2 pages). */
export function wheelDeltaToPixels(delta: number, deltaMode: number, pageSize: number): number {
  if (deltaMode === 1) return delta * LINE_PX;
  if (deltaMode === 2) return delta * pageSize;
  return delta;
}

/**
 * Zoom factor of a Ctrl/Cmd wheel or pinch event from a delta in pixels (normalise `deltaMode`
 * with `wheelDeltaToPixels` first). A mouse notch (|delta| >= 100) is one 1.15 step; the small deltas of a trackpad pinch scale proportionally, so it feels continuous.
 */
export function wheelZoomFactor(deltaY: number): number {
  const d = clamp(deltaY, -WHEEL_ZOOM_STEP_DELTA, WHEEL_ZOOM_STEP_DELTA);
  return Math.pow(WHEEL_ZOOM_STEP, -d / WHEEL_ZOOM_STEP_DELTA);
}
