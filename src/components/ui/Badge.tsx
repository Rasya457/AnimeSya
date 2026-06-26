import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "accent" | "secondary" | "outline" | "danger";
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = "secondary",
  children,
  ...props
}) => {
  return (
    <span
      className={twMerge(
        clsx(
          "inline-flex items-center px-2.5 py-0.5 rounded-md text-[10px] md:text-xs font-semibold tracking-wide uppercase select-none shrink-0",
          {
            "bg-accent/20 text-accent border border-accent/30": variant === "accent",
            "bg-zinc-800 text-zinc-300": variant === "secondary",
            "border border-zinc-700 text-zinc-400 bg-transparent": variant === "outline",
            "bg-red-500/10 text-red-400 border border-red-500/20": variant === "danger"
          }
        ),
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};
export default Badge;
