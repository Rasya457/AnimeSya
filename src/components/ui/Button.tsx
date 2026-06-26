import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  className,
  variant = "primary",
  size = "md",
  icon,
  children,
  ...props
}) => {
  return (
    <button
      className={twMerge(
        clsx(
          "inline-flex items-center justify-center gap-2 font-medium rounded-full cursor-pointer select-none transition-all active:scale-95 disabled:pointer-events-none disabled:opacity-50",
          {
            // Primary matches the vibrant green theme
            "bg-accent text-zinc-950 shadow-md shadow-accent-glow hover:bg-accent-hover hover:shadow-lg":
              variant === "primary",
            "bg-zinc-800 text-zinc-100 hover:bg-zinc-700": variant === "secondary",
            "border border-zinc-700 bg-zinc-900/30 text-zinc-100 backdrop-blur-sm hover:bg-zinc-800/80":
              variant === "outline",
            "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/40": variant === "ghost",
          },
          {
            "px-4 py-1.5 text-xs": size === "sm",
            "px-6 py-2.5 text-sm": size === "md",
            "px-8 py-3.5 text-base": size === "lg",
          }
        ),
        className
      )}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
};
export default Button;
