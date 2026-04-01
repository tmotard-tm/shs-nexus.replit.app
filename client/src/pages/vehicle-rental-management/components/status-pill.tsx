import { statusConfig, fonts } from "../lib/constants";

interface StatusPillProps {
  status: string;
  label?: string;
}

export function StatusPill({ status, label }: StatusPillProps) {
  const config = statusConfig[status] ?? {
    label: status,
    fg: "#3D4152",
    bg: "#F7F8FA",
  };

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 whitespace-nowrap"
      style={{
        fontFamily: fonts.dmSans,
        fontWeight: 500,
        fontSize: 11,
        color: config.fg,
        backgroundColor: config.bg,
        borderRadius: 6,
      }}
    >
      {label ?? config.label}
    </span>
  );
}
