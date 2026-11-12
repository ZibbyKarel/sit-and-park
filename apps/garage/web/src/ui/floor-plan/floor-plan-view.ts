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

/** Keeps the scaled plan covering the viewport, so it cannot be dragged out of sight. */
function clampView(view: View, width: number, height: number): View {
  return {
    scale: view.scale,
    tx: clamp(view.tx, width * (1 - view.scale), 0),
    ty: clamp(view.ty, height * (1 - view.scale), 0),
  };
}

/** Multiplies the scale by `factor`, keeping the viewport point (cx, cy) fixed. */
export function zoomAt(
  view: View,
  factor: number,
  cx: number,
  cy: number,
  width: number,
  height: number
): View {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  const ratio = scale / view.scale;
  return clampView(
    { scale, tx: cx - (cx - view.tx) * ratio, ty: cy - (cy - view.ty) * ratio },
    width,
    height
  );
}

export function panBy(view: View, dx: number, dy: number, width: number, height: number): View {
  return clampView({ ...view, tx: view.tx + dx, ty: view.ty + dy }, width, height);
}
