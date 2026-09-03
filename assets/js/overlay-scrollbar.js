/* Lightweight overlay scrollbar used by the list, grid, and prompt field. */
(() => {
  class OverlayScrollbar {
    constructor(
      target,
      {
        host = target.parentElement,
        arrows = false,
        kind = "default",
        insetTop = 6,
        insetBottom = 6,
        insetRight = 5,
        enabled = () => true,
        stateHost = null,
        stateClassBase = "",
      } = {},
    ) {
      this.target = target;
      this.host = host;
      this.arrows = arrows;
      this.kind = kind;
      this.enabled = enabled;
      this.insetTop = insetTop;
      this.insetBottom = insetBottom;
      this.insetRight = insetRight;
      this.stateHost = stateHost || host;
      this.stateClassBase = stateClassBase;
      if (!target || !host) return;
      target.classList.add("customScrollTarget");
      const root = document.createElement("div");
      root.className = `customScrollbar ${kind}Scrollbar`;
      root.dataset.kind = kind;
      root.setAttribute("aria-hidden", "true");
      if (arrows) {
        const controls = document.createElement("div");
        controls.className = "customScrollbarControls";
        for (const [dir, label] of [
          [-1, "向上滚动"],
          [1, "向下滚动"],
        ]) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "customScrollbarButton";
          button.dataset.dir = String(dir);
          button.setAttribute("aria-label", label);
          button.innerHTML =
            '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 7.5 6 3.7l3.8 3.8"/></svg>';
          controls.appendChild(button);
        }
        root.appendChild(controls);
      }
      const track = document.createElement("div");
      track.className = "customScrollbarTrack";
      const thumb = document.createElement("div");
      thumb.className = "customScrollbarThumb";
      track.appendChild(thumb);
      root.appendChild(track);
      host.appendChild(root);
      this.root = root;
      this.track = track;
      this.thumb = thumb;
      this.onScroll = () => this.schedule();
      target.addEventListener("scroll", this.onScroll, { passive: true });
      target.addEventListener("input", this.onScroll, { passive: true });
      root.addEventListener("click", (event) => this.handleClick(event));
      thumb.addEventListener("pointerdown", (event) => this.startDrag(event));
      this.resizeObserver =
        "ResizeObserver" in window
          ? new ResizeObserver(() => this.schedule())
          : null;
      this.resizeObserver?.observe(target);
      this.resizeObserver?.observe(host);
      this.mutationObserver =
        "MutationObserver" in window
          ? new MutationObserver(() => this.schedule())
          : null;
      this.mutationObserver?.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      this.schedule();
    }
    updateStateClasses(visible, atTop, atBottom) {
      this.target?.classList.toggle("isAtTop", !!atTop);
      this.target?.classList.toggle("isAtBottom", !!atBottom);
      if (this.stateHost && this.stateClassBase) {
        this.stateHost.classList.toggle(
          `${this.stateClassBase}-active`,
          !!visible,
        );
        this.stateHost.classList.toggle(`${this.stateClassBase}-top`, !!atTop);
        this.stateHost.classList.toggle(
          `${this.stateClassBase}-bottom`,
          !!atBottom,
        );
      }
    }
    position() {
      if (!this.root?.isConnected) return;
      const tr = this.target.getBoundingClientRect(),
        hr = this.host.getBoundingClientRect();
      this.root.style.top = `${Math.round(tr.top - hr.top + this.insetTop)}px`;
      this.root.style.right = `${Math.round(hr.right - tr.right + this.insetRight)}px`;
      this.root.style.height = `${Math.max(0, Math.round(tr.height - this.insetTop - this.insetBottom))}px`;
    }
    schedule() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.sync();
      });
    }
    sync() {
      if (!this.target || !this.root) return;
      this.position();
      const scrollRange = Math.max(
        0,
        this.target.scrollHeight - this.target.clientHeight,
      );
      const trackHeight = this.track.clientHeight;
      const visible =
        this.enabled() &&
        scrollRange > 2 &&
        trackHeight > 0 &&
        this.target.getClientRects().length > 0;
      const edgeSlack = 4;
      const atTop = visible && this.target.scrollTop <= edgeSlack;
      const atBottom =
        visible && scrollRange - this.target.scrollTop <= edgeSlack;
      this.root.classList.toggle("isScrollable", visible);
      this.updateStateClasses(visible, atTop, atBottom);
      if (!visible) return;
      const thumbHeight = Math.max(
        28,
        Math.min(
          trackHeight,
          trackHeight * (this.target.clientHeight / this.target.scrollHeight),
        ),
      );
      const travel = Math.max(0, trackHeight - thumbHeight);
      const top = scrollRange
        ? travel * (this.target.scrollTop / scrollRange)
        : 0;
      this.thumb.style.height = `${thumbHeight}px`;
      this.thumb.style.transform = `translate3d(0,${top}px,0)`;
    }
    handleClick(event) {
      const button = event.target.closest(".customScrollbarButton");
      if (button) {
        event.preventDefault();
        event.stopPropagation();
        const dir = Number(button.dataset.dir) || 1;
        this.target.scrollBy({
          top: dir * Math.max(96, this.target.clientHeight * 0.72),
          behavior: "smooth",
        });
        return;
      }
      if (event.target !== this.track) return;
      const rect = this.track.getBoundingClientRect();
      const thumbRect = this.thumb.getBoundingClientRect();
      const dir = event.clientY < thumbRect.top + thumbRect.height / 2 ? -1 : 1;
      this.target.scrollBy({
        top: dir * this.target.clientHeight * 0.82,
        behavior: "smooth",
      });
    }
    startDrag(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.thumb.setPointerCapture?.(event.pointerId);
      this.thumb.classList.add("isDragging");
      const startY = event.clientY,
        startScroll = this.target.scrollTop;
      const scrollRange = Math.max(
        0,
        this.target.scrollHeight - this.target.clientHeight,
      );
      const travel = Math.max(
        1,
        this.track.clientHeight - this.thumb.offsetHeight,
      );
      const move = (e) => {
        this.target.scrollTop =
          startScroll + (e.clientY - startY) * (scrollRange / travel);
      };
      const end = (e) => {
        this.thumb.releasePointerCapture?.(event.pointerId);
        this.thumb.classList.remove("isDragging");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end, { once: true });
      window.addEventListener("pointercancel", end, { once: true });
    }
  }
  window.MYPOverlayScrollbar = OverlayScrollbar;
})();
