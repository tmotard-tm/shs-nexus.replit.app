import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MainContentProps {
  children: ReactNode;
  className?: string;
}

export function MainContent({ children, className }: MainContentProps) {
  return (
    <div 
      className={cn(
        "flex-1 w-full min-w-0 overflow-x-hidden flex flex-col pt-16",
        className
      )}
    >
      {children}
    </div>
  );
}
