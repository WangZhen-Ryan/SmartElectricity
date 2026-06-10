import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { usePresenceClass } from "../hooks/usePresenceClass";

type Props<T extends ElementType> = {
  as?: ElementType;
  className?: string;
  enter?: "rise" | "fade" | "slide";
  delayIndex?: number;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

export default function AnimatedSection<T extends ElementType = "div">({
  as: Tag = "div",
  className = "",
  enter = "rise",
  delayIndex = 0,
  children,
  style,
  ...rest
}: Props<T>) {
  const presence = usePresenceClass([enter, delayIndex]);
  return (
    <Tag
      {...rest}
      className={`motion-section motion-${enter} ${presence.className} ${className}`.trim()}
      style={{
        ...(style as Record<string, unknown> | undefined),
        ["--motion-delay" as string]: `${Math.max(0, delayIndex) * 70}ms`,
      }}
    >
      {children}
    </Tag>
  );
}
