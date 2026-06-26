import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Skeleton: React.FC<SkeletonProps> = ({ className, ...props }) => {
  return (
    <div
      className={twMerge(
        clsx("animate-pulse rounded-lg bg-zinc-800/60 border border-zinc-700/20"),
        className
      )}
      {...props}
    />
  );
};
export default Skeleton;
