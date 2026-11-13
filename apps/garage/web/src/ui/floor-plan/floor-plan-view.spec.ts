import { clamp, IDENTITY_VIEW, MAX_SCALE, panBy, zoomAt } from './floor-plan-view';

describe('floor-plan-view', () => {
  it('clamp bounds a value on both sides', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('zoomAt keeps the anchor point fixed', () => {
    const view = zoomAt(IDENTITY_VIEW, 2, 400, 100, 1000, 500);
    expect(view.scale).toBe(2);
    // content point under the anchor: (400 - tx) / scale stays 400
    expect((400 - view.tx) / view.scale).toBe(400);
    expect((100 - view.ty) / view.scale).toBe(100);
  });

  it('zoomAt clamps the scale to 1..MAX_SCALE', () => {
    expect(zoomAt(IDENTITY_VIEW, 0.1, 0, 0, 1000, 500)).toEqual(IDENTITY_VIEW);
    expect(zoomAt(IDENTITY_VIEW, 1000, 0, 0, 1000, 500).scale).toBe(MAX_SCALE);
  });

  it('panBy cannot move the plan out of the viewport', () => {
    const zoomed = { scale: 2, tx: 0, ty: 0 };
    expect(panBy(zoomed, 50, 50, 1000, 500)).toEqual(zoomed);
    const far = panBy(zoomed, -5000, -5000, 1000, 500);
    expect(far.tx).toBe(-1000);
    expect(far.ty).toBe(-500);
  });

  it('panBy at scale 1 pans only along the axis the plan overflows (cover fit)', () => {
    // visible window 400 wide of a 1000 wide plan: slack is 600 on x, none on y
    const v = panBy(IDENTITY_VIEW, -5000, -5000, 400, 500, 1000, 500);
    expect(v).toEqual({ scale: 1, tx: -600, ty: 0 });
  });

  it('panBy at scale 1 is a no-op', () => {
    expect(panBy(IDENTITY_VIEW, 30, -30, 1000, 500)).toEqual(IDENTITY_VIEW);
  });
});
