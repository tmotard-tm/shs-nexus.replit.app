import { fonts, colors } from "../lib/constants";

interface StatCardProps {
  label: string;
  value: string | number;
  accentColor?: string;
}

export function StatCard({ label, value, accentColor }: StatCardProps) {
  return (
    <div
      className="flex flex-col justify-between"
      style={{
        padding: "20px 24px",
        border: `1px solid ${colors.rule}`,
        borderRadius: 8,
        backgroundColor: colors.background,
        minWidth: 0,
        flex: 1,
        borderTop: accentColor ? `3px solid ${accentColor}` : `3px solid transparent`,
      }}
    >
      <span
        style={{
          fontFamily: fonts.dmSans,
          fontWeight: 500,
          fontSize: 12,
          color: colors.inkMuted,
          marginBottom: 10,
          display: "block",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: fonts.dmSans,
          fontWeight: 500,
          fontSize: 22,
          color: colors.ink,
          letterSpacing: "-0.3px",
        }}
      >
        {value}
      </span>
    </div>
  );
}
