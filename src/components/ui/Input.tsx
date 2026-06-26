import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, leftIcon, rightIcon, type = "text", ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label className="text-xs font-semibold tracking-wide text-zinc-400 uppercase select-none">
            {label}
          </label>
        )}
        <div className="relative flex items-center w-full">
          {leftIcon && (
            <span className="absolute left-4 text-zinc-500 pointer-events-none shrink-0 z-10">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            type={type}
            className={twMerge(
              clsx(
                "w-full h-12 rounded-xl bg-zinc-900/40 border text-sm text-zinc-100 placeholder:text-zinc-500 backdrop-blur-md outline-none transition-all duration-200",
                "border-zinc-800/80 focus:border-accent/70 focus:bg-zinc-900/60 focus:shadow-[0_0_12px_rgba(16,185,129,0.1)]",
                {
                  "pl-11": leftIcon,
                  "pr-11": rightIcon,
                  "px-4": !leftIcon,
                  "border-red-500/80 focus:border-red-500 focus:shadow-[0_0_12px_rgba(239,68,68,0.1)]": error
                }
              ),
              className
            )}
            {...props}
          />
          {rightIcon && (
            <span className="absolute right-4 text-zinc-500 cursor-pointer hover:text-zinc-300 shrink-0 z-10">
              {rightIcon}
            </span>
          )}
        </div>
        {error && (
          <span className="text-xs font-medium text-red-400 select-none mt-0.5 pl-1">
            {error}
          </span>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
export default Input;
