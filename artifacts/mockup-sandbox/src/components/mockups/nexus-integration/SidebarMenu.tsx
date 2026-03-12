import {
  Home, BarChart3, Clock, Settings, Activity, Key, HelpCircle,
  Wrench, ChevronRight, Truck, PhoneCall, DollarSign, Archive,
  Building2, Users, MapPin, FileCode, FileText, LogOut, Moon
} from "lucide-react";

type SubItem = { label: string; icon: typeof Home; isNew?: boolean };
type Category = {
  label: string;
  icon: typeof Home;
  items: SubItem[];
  isNew?: boolean;
  expanded?: boolean;
};

const categories: Category[] = [
  {
    label: "Dashboards",
    icon: BarChart3,
    items: [
      { label: "Main Dashboard",      icon: BarChart3 },
      { label: "Fleet Distribution",  icon: Activity },
      { label: "Operations",          icon: BarChart3 },
      { label: "Rental",              icon: Truck },
    ],
  },
  {
    label: "Queues",
    icon: Clock,
    items: [
      { label: "Task Queue", icon: Clock },
    ],
  },
  {
    label: "Management",
    icon: Settings,
    items: [
      { label: "Storage Spots",    icon: MapPin },
      { label: "Integrations",     icon: Settings },
      { label: "User Management",  icon: Users },
      { label: "Templates",        icon: FileCode },
    ],
  },
  {
    label: "Fleet Scope",
    icon: Wrench,
    isNew: true,
    expanded: true,
    items: [
      { label: "Repair Pipeline",    icon: Wrench,     isNew: false },
      { label: "Batch Caller",       icon: PhoneCall,  isNew: false },
      { label: "Decommissioning",    icon: Archive,    isNew: false },
      { label: "Fleet Cost",         icon: DollarSign, isNew: false },
      { label: "PMF Vehicles",       icon: Building2,  isNew: false },
      { label: "SMS Conversations",  icon: FileText,   isNew: false },
    ],
  },
  {
    label: "Activity",
    icon: Activity,
    items: [
      { label: "Audit Log", icon: FileText },
    ],
  },
  {
    label: "Account",
    icon: Key,
    items: [
      { label: "API Keys", icon: Key },
    ],
  },
  {
    label: "Help",
    icon: HelpCircle,
    items: [
      { label: "Documentation", icon: HelpCircle },
    ],
  },
];

export function SidebarMenu() {
  return (
    <div
      className="min-h-screen flex items-start justify-center p-8 pt-12"
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        fontFamily: "'Poppins', system-ui, sans-serif",
      }}
    >
      {/* Hamburger button */}
      <div className="relative">
        {/* Trigger button */}
        <div className="w-10 h-10 rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm flex items-center justify-center mb-2 cursor-pointer shadow-lg">
          <div className="flex flex-col gap-1">
            <span className="block w-4 h-0.5 bg-white/80 rounded" />
            <span className="block w-4 h-0.5 bg-white/80 rounded" />
            <span className="block w-4 h-0.5 bg-white/80 rounded" />
          </div>
        </div>

        {/* Dropdown panel */}
        <div
          className="w-64 rounded-xl border border-zinc-700/60 bg-zinc-900 shadow-2xl overflow-hidden"
          style={{ boxShadow: "0 25px 50px rgba(0,0,0,0.6)" }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-3 py-3 border-b border-zinc-700/60">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
              <Settings className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-sm text-white" style={{ fontFamily: "'Montserrat', system-ui" }}>
              Nexus
            </span>
            <div className="ml-auto w-7 h-7 rounded-md border border-zinc-600 bg-zinc-800 flex items-center justify-center cursor-pointer">
              <Moon className="w-3.5 h-3.5 text-zinc-400" />
            </div>
          </div>

          {/* Role badge */}
          <div className="px-3 py-2 border-b border-zinc-700/60">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-zinc-800 text-xs text-zinc-300">
              <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                <span className="text-[8px] font-bold text-white">D</span>
              </div>
              <span>Developer</span>
            </div>
          </div>

          {/* Home */}
          <div className="flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 cursor-pointer">
            <Home className="w-4 h-4" />
            <span>Home</span>
          </div>

          <div className="h-px bg-zinc-700/60 my-1" />

          {/* Categories */}
          {categories.map((cat) => {
            const CatIcon = cat.icon;
            return (
              <div key={cat.label}>
                {/* Category row */}
                <div
                  className={`flex items-center gap-3 px-3 py-2 text-sm cursor-pointer relative
                    ${cat.isNew
                      ? "text-amber-300 bg-amber-500/10 hover:bg-amber-500/15"
                      : "text-zinc-300 hover:bg-zinc-800"
                    }`}
                >
                  <CatIcon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1">{cat.label}</span>
                  {cat.isNew && (
                    <span className="text-[9px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full">
                      NEW
                    </span>
                  )}
                  <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 ${cat.isNew ? "text-amber-400" : "text-zinc-500"}`} />
                </div>

                {/* Expanded Fleet Scope sub-items */}
                {cat.expanded && (
                  <div className="bg-zinc-800/60 border-l-2 border-amber-500/50 ml-4 mr-2 mb-1 rounded-r-lg overflow-hidden">
                    {cat.items.map((item) => {
                      const ItemIcon = item.icon;
                      return (
                        <div
                          key={item.label}
                          className="flex items-center gap-3 px-3 py-2 text-xs text-amber-200/80 hover:bg-amber-500/10 cursor-pointer transition-colors"
                        >
                          <ItemIcon className="w-3.5 h-3.5 text-amber-400/70 flex-shrink-0" />
                          <span>{item.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          <div className="h-px bg-zinc-700/60 my-1" />

          {/* Logout */}
          <div className="flex items-center gap-3 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800 cursor-pointer">
            <LogOut className="w-4 h-4" />
            <span>Log out</span>
          </div>
        </div>
      </div>
    </div>
  );
}
