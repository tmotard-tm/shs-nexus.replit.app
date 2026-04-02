import { Bell, Search, Home, ChevronLeft } from "lucide-react";
import { Link } from "wouter";
import { fonts, colors } from "../lib/constants";

interface RouteReadyTopbarProps {
  title: string;
  notificationCount?: number;
}

export function RouteReadyTopbar({ title, notificationCount = 3 }: RouteReadyTopbarProps) {
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

        <div className="flex items-center justify-center flex-1">
          <div className="relative" style={{ width: 320 }}>
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
              style={{ color: colors.inkMuted }}
            />
            <input
              type="text"
              placeholder="Search by name or LDAP..."
              className="w-full pl-9 pr-3 outline-none"
              style={{
                fontFamily: fonts.dmSans,
                fontWeight: 400,
                fontSize: 14,
                height: 36,
                borderRadius: 8,
                border: `1px solid ${colors.rule}`,
                backgroundColor: colors.surface,
                color: colors.ink,
              }}
            />
          </div>
        </div>

        <div className="flex-1 flex items-center justify-end gap-4">
          <button className="relative p-2 rounded-md hover:bg-[#F7F8FA] transition-colors">
            <Bell className="h-5 w-5" style={{ color: colors.inkSoft }} />
            {notificationCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-white"
                style={{
                  fontFamily: fonts.dmSans,
                  fontWeight: 500,
                  fontSize: 10,
                  width: 18,
                  height: 18,
                  backgroundColor: colors.red,
                }}
              >
                {notificationCount}
              </span>
            )}
          </button>
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
