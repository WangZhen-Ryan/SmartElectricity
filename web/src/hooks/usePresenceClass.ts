import { useEffect, useState } from "react";
import { useReducedMotionFlag } from "./useReducedMotionFlag";

export function usePresenceClass(deps: unknown[] = []) {
  const reduced = useReducedMotionFlag();
  const [entered, setEntered] = useState(reduced);

  useEffect(() => {
    if (reduced) {
      setEntered(true);
      return;
    }
    setEntered(false);
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [reduced, ...deps]);

  return {
    entered,
    className: entered ? "is-visible" : "is-entering",
  };
}
