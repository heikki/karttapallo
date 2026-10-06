import type { ReactiveController, ReactiveControllerHost } from 'lit';

interface Box {
  left: number;
  top: number;
  width: number;
}

/**
 * Header-drag for a floating panel: the Info panel parks in a corner and can
 * be pulled aside to see what is under it.
 *
 * The offset from the resting spot is written straight to the box's transform
 * rather than through a reactive property: a pointermove per frame shouldn't
 * cost a render, and the element survives re-renders, so a dragged panel stays
 * put while its contents change. Closing forgets it — the host calls `reset()`.
 */
export class PanelDrag implements ReactiveController {
  private readonly _box: () => HTMLElement | null;
  private readonly _isOpen: () => boolean;
  private _offsetX = 0;
  private _offsetY = 0;
  private _start: {
    pointerX: number;
    pointerY: number;
    offsetX: number;
    offsetY: number;
    base: Box | null;
  } | null = null;

  /**
   * @param box the element that moves — null until the host has rendered
   * @param isOpen whether the panel is showing, so a resize leaves a closed one alone
   */
  constructor(
    host: ReactiveControllerHost,
    box: () => HTMLElement | null,
    isOpen: () => boolean
  ) {
    this._box = box;
    this._isOpen = isOpen;
    host.addController(this);
  }

  hostConnected() {
    window.addEventListener('resize', this._onResize);
  }

  hostDisconnected() {
    window.removeEventListener('resize', this._onResize);
    this._end();
  }

  /**
   * Back to the corner: a panel dragged aside once shouldn't decide where the
   * next open appears, half a session later.
   */
  reset() {
    this._offsetX = 0;
    this._offsetY = 0;
    this._apply();
  }

  readonly onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    // Let the close button have its click.
    if (
      (e.target as HTMLElement | null)?.classList.contains('close') === true
    ) {
      return;
    }
    e.preventDefault();
    this._start = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      offsetX: this._offsetX,
      offsetY: this._offsetY,
      // Measured once, here: mid-drag the rect lags a frame behind the offset
      // fields, which would drift the clamp bounds by a step each move.
      base: this._baseBox()
    };
    // On window, not the header: the pointer routinely outruns the box.
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onEnd);
    window.addEventListener('pointercancel', this._onEnd);
  };

  private _apply() {
    const box = this._box();
    if (box === null) return;
    box.style.transform =
      this._offsetX === 0 && this._offsetY === 0
        ? ''
        : `translate(${this._offsetX}px, ${this._offsetY}px)`;
  }

  /**
   * Where the box sits with no offset applied. Derived from the live rect,
   * which already includes the applied transform — so this is only correct
   * while the offset fields and that transform agree, i.e. not mid-drag.
   * Returns null when the box has no layout to measure (closed, or happy-dom).
   */
  private _baseBox(): Box | null {
    const box = this._box();
    if (box === null) return null;
    const rect = box.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return {
      left: rect.left - this._offsetX,
      top: rect.top - this._offsetY,
      width: rect.width
    };
  }

  /**
   * Keep the panel grabbable: the header can't leave the top of the viewport,
   * and a strip of the box always stays inside the other three edges.
   */
  private _clamp(base: Box) {
    const edge = 60;
    this._offsetX = Math.min(
      window.innerWidth - edge - base.left,
      Math.max(edge - base.width - base.left, this._offsetX)
    );
    this._offsetY = Math.min(
      window.innerHeight - edge - base.top,
      Math.max(-base.top, this._offsetY)
    );
  }

  private readonly _onResize = () => {
    if (!this._isOpen()) return;
    if (this._offsetX === 0 && this._offsetY === 0) return;
    const base = this._baseBox();
    if (base === null) return;
    this._clamp(base);
    this._apply();
  };

  private readonly _onMove = (e: PointerEvent) => {
    const start = this._start;
    if (start === null) return;
    this._offsetX = start.offsetX + e.clientX - start.pointerX;
    this._offsetY = start.offsetY + e.clientY - start.pointerY;
    if (start.base !== null) this._clamp(start.base);
    this._apply();
  };

  private readonly _onEnd = () => {
    this._end();
  };

  private _end() {
    this._start = null;
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onEnd);
    window.removeEventListener('pointercancel', this._onEnd);
  }
}
