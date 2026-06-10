import { Children, type ReactNode } from "react";

type Props = {
  className?: string;
  itemClassName?: string;
  delayStep?: number;
  children: ReactNode;
};

export default function StaggerGroup({
  className = "",
  itemClassName = "",
  delayStep = 70,
  children,
}: Props) {
  return (
    <div className={`motion-stagger ${className}`.trim()}>
      {Children.toArray(children).map((child, index) => (
        <div
          key={index}
          className={`motion-stagger-item ${itemClassName}`.trim()}
          style={{ ["--motion-delay" as string]: `${index * delayStep}ms` }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
