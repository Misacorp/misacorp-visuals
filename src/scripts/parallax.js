// Fallback for browsers without CSS scroll-driven animations. Where they exist (Chromium,
// Safari 26+) the CSS in main.css animates the layers on the compositor and this does nothing.
// It only sets --py (px scrolled within the hero) on the hero once per frame; CSS does the maths.
export function initParallax() {
  const hero = document.querySelector('.hero');
  if (
    !hero ||
    CSS.supports('animation-timeline: scroll()') ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  )
    return;

  let height = 0; // cached by ResizeObserver so the scroll path never reads layout
  let scroll = 0;
  let visible = true;
  let queued = false;

  const write = () => {
    queued = false;
    hero.style.setProperty('--py', `${Math.min(scroll, height)}px`);
  };
  const schedule = () => {
    scroll = window.scrollY;
    if (visible && !queued) {
      queued = true;
      requestAnimationFrame(write);
    }
  };

  new ResizeObserver(([entry]) => {
    height = entry.contentRect.height;
    schedule();
  }).observe(hero);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) schedule();
  }).observe(hero);
  addEventListener('scroll', schedule, { passive: true });
}
