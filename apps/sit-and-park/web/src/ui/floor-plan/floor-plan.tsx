'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';

import {
  IDENTITY_VIEW,
  panBy,
  wheelDeltaToPixels,
  wheelZoomFactor,
  zoomAt,
  type View,
} from './floor-plan-view';
import styles from './floor-plan.module.css';

export interface FloorPlanShape {
  id: string;
  /** Position and size in plan units (the viewBox). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Short text drawn inside the shape when zoomed in enough; also part of the accessible name. */
  label: string;
  /** Full accessible name. */
  ariaLabel: string;
  /** Key into `FloorPlanProps.tones`. */
  tone: string;
  /** CSS colour drawn as the stroke (e.g. a team colour). */
  outlineColor?: string | undefined;
  /** Not interactive. */
  disabled?: boolean | undefined;
  /** Filtered out: drawn faint. */
  dimmed?: boolean | undefined;
}

export interface FloorPlanProps {
  /** Static image URL, drawn with SVG `<image>`; never fetched or injected as markup. */
  backgroundSrc: string;
  /** Plan size in plan units; becomes the viewBox and fixes the aspect ratio. */
  width: number;
  height: number;
  shapes: readonly FloorPlanShape[];
  /** Tone key -> CSS colour used as the shape fill (e.g. `rgb(var(--...))`). Unknown tone: no fill. */
  tones: Readonly<Record<string, string>>;
  selectedIds?: ReadonlySet<string> | readonly string[] | undefined;
  /** Click, Enter or Space on an enabled shape; `multi` = Ctrl or Cmd held. */
  onShapeActivate?: ((id: string, modifiers: { multi: boolean }) => void) | undefined;
  /**
   * Focus this shape (which scrolls it into view) the first time it is drawn; once per id, so
   * re-renders and refetches never pull focus back. Only compared with shape ids.
   */
  focusId?: string | undefined;
  /** Already translated by the caller. */
  labels: {
    zoomIn: string;
    zoomOut: string;
    reset: string;
    hint: string;
    enterFullscreen: string;
    exitFullscreen: string;
  };
}

const DRAG_THRESHOLD_PX = 6;
const BUTTON_FACTOR = 1.25;
/** From this zoom on, shape labels are shown. */
const LABEL_SCALE = 3;

interface ShapeLayerProps {
  shapes: readonly FloorPlanShape[];
  tones: Readonly<Record<string, string>>;
  selected: ReadonlySet<string>;
  activate: (id: string, multi: boolean) => void;
}

/** Memoised so that panning and zooming (a transform change) never re-render the shapes. */
const ShapeLayer = memo(function ShapeLayer({
  shapes,
  tones,
  selected,
  activate,
}: ShapeLayerProps) {
  return (
    <>
      {shapes.map((s) => (
        <g
          key={s.id}
          className={styles.shape}
          role="button"
          tabIndex={s.disabled ? -1 : 0}
          aria-label={s.ariaLabel}
          data-shape-id={s.id}
          aria-pressed={selected.has(s.id)}
          aria-disabled={s.disabled || undefined}
          data-outlined={s.outlineColor ? '' : undefined}
          data-dimmed={s.dimmed ? '' : undefined}
          onClick={(e: MouseEvent) => activate(s.id, e.ctrlKey || e.metaKey)}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            activate(s.id, e.ctrlKey || e.metaKey);
          }}
        >
          <title>{s.ariaLabel}</title>
          <rect
            x={s.x}
            y={s.y}
            width={s.width}
            height={s.height}
            fill={tones[s.tone]}
            // Selected stroke is set in CSS and must win over the outline colour.
            style={s.outlineColor && !selected.has(s.id) ? { stroke: s.outlineColor } : undefined}
          />
          <text
            className={styles.label}
            x={s.x + s.width / 2}
            y={s.y + s.height / 2}
            // Fits the label's width too (bold digits are ~0.65 em), or it spills onto the neighbour.
            fontSize={Math.min(s.height * 0.5, s.width / (Math.max(s.label.length, 1) * 0.65))}
            aria-hidden="true"
          >
            {s.label}
          </text>
        </g>
      ))}
    </>
  );
});

export function FloorPlan({
  backgroundSrc,
  width,
  height,
  shapes,
  tones,
  selectedIds,
  onShapeActivate,
  focusId,
  labels,
}: FloorPlanProps) {
  const [view, setView] = useState<View>(IDENTITY_VIEW);
  const [dragging, setDragging] = useState(false);
  // CSS-only fullscreen: the native Fullscreen API would hide the portalled dialogs and toasts.
  const [fullscreen, setFullscreen] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef({ x: 0, y: 0 });
  const moved = useRef(false);

  const selected = useMemo(() => new Set(selectedIds ?? []), [selectedIds]);

  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || focused.current === focusId) return;
    // Equality against the attribute, never a selector built from `focusId`.
    const el = Array.from(
      svgRef.current?.querySelectorAll<SVGGElement>('[data-shape-id]') ?? []
    ).find((g) => g.dataset['shapeId'] === focusId);
    if (!el) return;
    el.focus();
    focused.current = focusId;
  }, [focusId, shapes]);

  const callback = useRef(onShapeActivate);
  useEffect(() => {
    callback.current = onShapeActivate;
  });
  // A drag must not activate the shape under the pointer.
  const activate = useCallback((id: string, multi: boolean) => {
    if (moved.current) return;
    if (shapesById.current.get(id)?.disabled) return;
    callback.current?.(id, { multi });
  }, []);
  const shapesById = useRef(new Map<string, FloorPlanShape>());
  shapesById.current = useMemo(() => new Map(shapes.map((s) => [s.id, s])), [shapes]);

  /**
   * Screen pixels -> viewBox units. The SVG covers its box (`slice`, pinned top-left), so the
   * default view fits the shorter axis; `vw`/`vh` are the visible window in plan units.
   */
  const metrics = () => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0)
      return { k: 1, left: 0, top: 0, vw: width, vh: height };
    const k = Math.max(r.width / width, r.height / height);
    return { k, left: r.left, top: r.top, vw: r.width / k, vh: r.height / k };
  };

  // Wheel needs a non-passive listener to be able to preventDefault. Ctrl/Cmd+wheel (and a
  // trackpad pinch, which arrives as a wheel with ctrlKey) zooms at the pointer; a plain wheel
  // or two-finger scroll pans. A plain wheel that cannot move the plan (e.g. at the base zoom)
  // is left alone so the page scrolls.
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      const m = metrics();
      const v = viewRef.current;
      const dy = wheelDeltaToPixels(e.deltaY, e.deltaMode, window.innerHeight);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = wheelZoomFactor(dy);
        setView((cur) =>
          zoomAt(
            cur,
            factor,
            (e.clientX - m.left) / m.k,
            (e.clientY - m.top) / m.k,
            m.vw,
            m.vh,
            width,
            height
          )
        );
        return;
      }
      const dx = wheelDeltaToPixels(e.deltaX, e.deltaMode, window.innerWidth);
      const next = panBy(v, -dx / m.k, -dy / m.k, m.vw, m.vh, width, height);
      if (next.tx === v.tx && next.ty === v.ty) return;
      e.preventDefault();
      viewRef.current = next;
      setView(next);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [width, height]);

  // Lock page scroll while in fullscreen; Esc leaves it unless something else (an open dialog)
  // already handled the key.
  useEffect(() => {
    if (!fullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      setFullscreen(false);
      setView(IDENTITY_VIEW);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [fullscreen]);

  const toggleFullscreen = () => {
    setView(IDENTITY_VIEW); // the visible window changes size
    setFullscreen((f) => !f);
  };

  function onPointerDown(e: PointerEvent<SVGSVGElement>) {
    if (pointers.current.size === 0) {
      moved.current = false;
      start.current = { x: e.clientX, y: e.clientY };
    } else {
      // Second finger: a pinch is a gesture, never a click.
      moved.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const m = metrics();
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.entries()].map(([id, p]) =>
        id === e.pointerId ? { x: e.clientX, y: e.clientY } : p
      ) as [{ x: number; y: number }, { x: number; y: number }];
      const [pa, pb] = [...pointers.current.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      const before = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      const after = Math.hypot(a.x - b.x, a.y - b.y);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (before === 0 || after === 0) return;
      const cx = ((a.x + b.x) / 2 - m.left) / m.k;
      const cy = ((a.y + b.y) / 2 - m.top) / m.k;
      setView((v) => zoomAt(v, after / before, cx, cy, m.vw, m.vh, width, height));
      return;
    }
    if (!moved.current) {
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) < DRAG_THRESHOLD_PX)
        return;
      moved.current = true;
      // Captured only now: capturing on pointerdown would retarget the click away from the shape.
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setView((v) =>
      panBy(v, (e.clientX - prev.x) / m.k, (e.clientY - prev.y) / m.k, m.vw, m.vh, width, height)
    );
  }

  function onPointerEnd(e: PointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) setDragging(false);
  }

  const zoomCentre = (factor: number) => {
    const m = metrics();
    setView((v) => zoomAt(v, factor, m.vw / 2, m.vh / 2, m.vw, m.vh, width, height));
  };

  return (
    <div className={styles.root} data-fullscreen={fullscreen ? '' : undefined}>
      <div className={styles.viewport} style={{ aspectRatio: `${width} / ${height}` }}>
        <svg
          ref={svgRef}
          className={styles.svg}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMinYMin slice"
          data-dragging={dragging ? '' : undefined}
          data-labels={view.scale >= LABEL_SCALE ? '' : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <g
            className={styles.transformed}
            transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}
          >
            <image href={backgroundSrc} x={0} y={0} width={width} height={height} />
            <ShapeLayer shapes={shapes} tones={tones} selected={selected} activate={activate} />
          </g>
        </svg>
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.button}
          aria-label={labels.zoomIn}
          onClick={() => zoomCentre(BUTTON_FACTOR)}
        >
          +
        </button>
        <button
          type="button"
          className={styles.button}
          aria-label={labels.zoomOut}
          onClick={() => zoomCentre(1 / BUTTON_FACTOR)}
        >
          −
        </button>
        <button type="button" className={styles.button} onClick={() => setView(IDENTITY_VIEW)}>
          {labels.reset}
        </button>
        <button
          type="button"
          className={styles.button}
          aria-pressed={fullscreen}
          onClick={toggleFullscreen}
        >
          {fullscreen ? labels.exitFullscreen : labels.enterFullscreen}
        </button>
      </div>
      <p className={styles.hint}>{labels.hint}</p>
    </div>
  );
}
