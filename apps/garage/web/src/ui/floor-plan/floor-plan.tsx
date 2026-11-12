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

import { IDENTITY_VIEW, panBy, zoomAt, type View } from './floor-plan-view';
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
  /** Already translated by the caller. */
  labels: { zoomIn: string; zoomOut: string; reset: string; hint: string };
}

const DRAG_THRESHOLD_PX = 6;
const BUTTON_FACTOR = 1.25;
const WHEEL_FACTOR = 1.15;
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
  labels,
}: FloorPlanProps) {
  const [view, setView] = useState<View>(IDENTITY_VIEW);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef({ x: 0, y: 0 });
  const moved = useRef(false);

  const selected = useMemo(() => new Set(selectedIds ?? []), [selectedIds]);

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

  /** Screen pixels -> viewBox units, accounting for letterboxing from max-height. */
  const metrics = () => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return { k: 1, left: 0, top: 0 };
    const k = Math.min(r.width / width, r.height / height);
    return {
      k,
      left: r.left + (r.width - width * k) / 2,
      top: r.top + (r.height - height * k) / 2,
    };
  };

  // Wheel needs a non-passive listener to be able to preventDefault; only Ctrl/Cmd zooms,
  // anything else is left alone so the page scrolls.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const m = metrics();
      const factor = e.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR;
      setView((v) =>
        zoomAt(v, factor, (e.clientX - m.left) / m.k, (e.clientY - m.top) / m.k, width, height)
      );
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [width, height]);

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
      setView((v) => zoomAt(v, after / before, cx, cy, width, height));
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
    setView((v) => panBy(v, (e.clientX - prev.x) / m.k, (e.clientY - prev.y) / m.k, width, height));
  }

  function onPointerEnd(e: PointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) setDragging(false);
  }

  const zoomCentre = (factor: number) =>
    setView((v) => zoomAt(v, factor, width / 2, height / 2, width, height));

  return (
    <div className={styles.root}>
      <div className={styles.viewport} style={{ aspectRatio: `${width} / ${height}` }}>
        <svg
          ref={svgRef}
          className={styles.svg}
          viewBox={`0 0 ${width} ${height}`}
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
        </div>
      </div>
      <p className={styles.hint}>{labels.hint}</p>
    </div>
  );
}
