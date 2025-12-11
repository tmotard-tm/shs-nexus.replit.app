import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MainContentProps {
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function MainContent({ children, className, noPadding = false }: MainContentProps) {
  return (
    <div 
      className={cn(
        "flex-1 w-full min-w-0 overflow-x-hidden flex flex-col",
        !noPadding && "pt-16",
        className
      )}
    >
      {children}
    </div>
  );
}
