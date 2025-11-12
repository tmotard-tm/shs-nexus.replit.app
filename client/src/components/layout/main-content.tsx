import { ReactNode } from "react";
import { useSidebar } from "@/hooks/use-sidebar";
import { cn } from "@/lib/utils";

interface MainContentProps {
  children: ReactNode;
  className?: string;
}

export function MainContent({ children, className }: MainContentProps) {
  const { isCollapsed } = useSidebar();
  
  return (
    <div 
      className={cn(
        "flex-1 w-full min-w-0 overflow-x-hidden flex flex-col transition-all duration-300",
        isCollapsed ? "pl-16" : "pl-64",
        className
      )}
    >
      {children}
    </div>
  );
}