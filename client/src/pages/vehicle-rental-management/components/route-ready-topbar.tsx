import { Home, ChevronLeft } from "lucide-react";
import { Link } from "wouter";
import { fonts, colors } from "../lib/constants";
import { Sidebar as GlobalNavMenu } from "@/components/layout/sidebar";

interface RouteReadyTopbarProps {
  title: string;
}

export function RouteReadyTopbar({ title }: RouteReadyTopbarProps) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = "/";
    }
  };

  return (
    <header
      className="sticky top-0 z-20 flex flex-col shrink-0"
      style={{ backgroundColor: colors.background, borderBottom: `1px solid ${colors.rule}` }}
    >
      {/* Back + Nexus nav row */}
      <div className="flex items-center gap-3 px-8 pt-2 pb-0">
        <GlobalNavMenu inline />
        <span style={{ color: colors.inkMuted, fontSize: 10 }}>·</span>
        <button
          onClick={handleBack}
          className="flex items-center gap-1 text-xs hover:opacity-70 transition-opacity"
          style={{ color: colors.inkMuted }}
        >
          <ChevronLeft size={13} />
          Back
        </button>
        <span style={{ color: colors.inkMuted, fontSize: 10 }}>·</span>
        <Link href="/" className="flex items-center gap-1 text-xs hover:opacity-70 transition-opacity" style={{ color: colors.inkMuted }}>
          <Home size={13} />
          <span>Nexus</span>
        </Link>
      </div>

      {/* Main header row */}
      <div className="flex items-center px-8" style={{ height: 50 }}>
        <div className="flex-1">
          <h1
            style={{
              fontFamily: fonts.syne,
              fontWeight: 700,
              fontSize: 18,
              color: colors.ink,
              margin: 0,
            }}
          >
            {title}
          </h1>
        </div>

        <div className="flex-1 flex items-center justify-end gap-4">
          <span
            style={{
              fontFamily: fonts.dmSans,
              fontWeight: 300,
              fontSize: 12,
              color: colors.inkMuted,
            }}
          >
            {today}
          </span>
        </div>
      </div>
    </header>
  );
}
