import { Construction } from "lucide-react";
import { fonts, colors } from "../lib/constants";

interface WipPlaceholderProps {
  moduleName: string;
}

export function WipPlaceholder({ moduleName }: WipPlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center" style={{ minHeight: "60vh" }}>
      <Construction className="h-12 w-12 mb-6" style={{ color: colors.inkMuted }} />
      <h2
        style={{
          fontFamily: fonts.syne,
          fontWeight: 800,
          fontSize: 24,
          color: colors.ink,
          margin: 0,
          marginBottom: 8,
        }}
      >
        {moduleName}
      </h2>
      <p
        style={{
          fontFamily: fonts.dmSans,
          fontWeight: 300,
          fontSize: 16,
          color: colors.inkMuted,
          margin: 0,
          marginBottom: 16,
        }}
      >
        This module is under construction
      </p>
      <p
        style={{
          fontFamily: fonts.dmSans,
          fontWeight: 400,
          fontSize: 14,
          color: colors.inkMuted,
          margin: 0,
          marginBottom: 20,
        }}
      >
        Estimated availability: Coming soon
      </p>
      <span
        className="px-2.5 py-1 rounded-md"
        style={{
          fontFamily: fonts.dmSans,
          fontWeight: 500,
          fontSize: 11,
          color: colors.amber,
          backgroundColor: colors.amberLight,
          borderRadius: 6,
        }}
      >
        WIP
      </span>
    </div>
  );
}
