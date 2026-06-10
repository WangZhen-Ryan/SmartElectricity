import type { ReactNode } from "react";
import { usePresenceClass } from "../hooks/usePresenceClass";

type Props = {
  switchKey: string | number;
  className?: string;
  mode?: "fade" | "rise" | "slide";
  children: ReactNode;
};

export default function AnimatedSwitch({
  switchKey,
  className = "",
  mode = "fade",
  children,
}: Props) {
  const presence = usePresenceClass([switchKey, mode]);
  return (
    <div
      key={String(switchKey)}
      className={`motion-switch motion-${mode} ${presence.className} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
