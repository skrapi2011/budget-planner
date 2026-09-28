import { useEffect, useRef, useState } from 'react';

/**
 * Returns a value that starts at 0 and "jumps" to `target` after first paint,
 * so CSS width transitions animate progress bars from 0 on mount and between
 * old/new values when the data changes (month switch etc.).
 * The consuming element must have its own `transition-all`/`transition-[width]`.
 */
export function useAnimatedValue(target) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setValue(Number(target) || 0));
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return value;
}

/**
 * Count-up animation for stat cards. Animates from the previously displayed
 * number to `target` (eases out cubic). Non-numeric values pass through
 * unchanged (e.g. "N/A", "85%").
 */
export function useCountUp(target, duration = 500) {
  const numeric = typeof target === 'number' && Number.isFinite(target);
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (!numeric) return undefined;
    let raf;
    const start = performance.now();
    const from = fromRef.current;
    if (from === target) return undefined;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = from + (target - from) * eased;
      fromRef.current = val;
      setDisplay(val);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, numeric, duration]);

  return numeric ? display : target;
}
