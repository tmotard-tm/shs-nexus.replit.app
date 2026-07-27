import './_group.css';
import React, { useState, useMemo } from 'react';
import { 
  PhoneCall, Clock, CheckCircle2, ChevronRight, SkipForward, ArrowRight,
  AlertTriangle, CarFront, FileText, User, MapPin, Search, List
} from 'lucide-react';
import { cn } from '@/lib/utils';

// --- Types & Mock Data ---

interface MasterRow {
  id: string;
  truck_number: string;
  tech_name: string;
  employee_status: string; // Active, New Hire, Term/Leave
  veh_desc: string;
  rental_class: string;
  daily_cost: number;
  cost_delta: number | null;
  cost_over: boolean;
  shop_name: string | null;
  shop_po_status: string | null;
  days_open: number;
  callable: boolean;
  operator_mark: string | null; // O, C, P
  mark_at: string | null;
}

const isByov = (truck: string) => truck.trim().startsWith('88') || truck.trim().startsWith('088');

const MOCK_DATA: MasterRow[] = [
  {
    id: "r1",
    truck_number: "61385",
    tech_name: "John Smith",
    employee_status: "Active",
    veh_desc: "2023 Ford Transit Cargo",
    rental_class: "Premium SUV",
    daily_cost: 95.50,
    cost_delta: 20.50,
    cost_over: true,
    shop_name: "Bob's Auto",
    shop_po_status: "Awaiting Parts",
    days_open: 42,
    callable: true,
    operator_mark: "O",
    mark_at: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: "r2",
    truck_number: "40192",
    tech_name: "Bob Brown",
    employee_status: "Active",
    veh_desc: "2020 Chevy Express",
    rental_class: "Cargo Van",
    daily_cost: 110.00,
    cost_delta: 30.00,
    cost_over: true,
    shop_name: "Fleet Services Inc",
    shop_po_status: "Estimate Approved",
    days_open: 26,
    callable: true,
    operator_mark: null,
    mark_at: null
  },
  {
    id: "r3",
    truck_number: "82041",
    tech_name: "Jane Doe",
    employee_status: "Term/Leave",
    veh_desc: "2022 Dodge Express",
    rental_class: "Standard Van",
    daily_cost: 65.00,
    cost_delta: null,
    cost_over: false,
    shop_name: "City Garage",
    shop_po_status: "Work in Progress",
    days_open: 7,
    callable: true,
    operator_mark: null,
    mark_at: null
  },
  {
    id: "r4",
    truck_number: "99214",
    tech_name: "Alice White",
    employee_status: "Active",
    veh_desc: "2021 Ford Transit Connect",
    rental_class: "Compact Van",
    daily_cost: 72.00,
    cost_delta: null,
    cost_over: false,
    shop_name: "Quick Fix",
    shop_po_status: "Pending Estimate",
    days_open: 17,
    callable: true,
    operator_mark: "C",
    mark_at: new Date(Date.now() - 86400000).toISOString()
  },
  {
    id: "r5",
    truck_number: "88217",
    tech_name: "Luis Herrera",
    employee_status: "Active",
    veh_desc: "2019 GMC Savana",
    rental_class: "Cargo Van",
    daily_cost: 46.00,
    cost_delta: null,
    cost_over: false,
    shop_name: null,
    shop_po_status: null,
    days_open: 11,
    callable: false,
    operator_mark: null,
    mark_at: null
  },
  {
    id: "r6",
    truck_number: "10283",
    tech_name: "Sarah Jenkins",
    employee_status: "New Hire",
    veh_desc: "2024 Ford E-Transit",
    rental_class: "Compact Van",
    daily_cost: 58.00,
    cost_delta: null,
    cost_over: false,
    shop_name: "Downtown Motors",
    shop_po_status: "In Review",
    days_open: 2,
    callable: true,
    operator_mark: null,
    mark_at: null
  },
  {
    id: "r7",
    truck_number: "77321",
    tech_name: "Michael Chen",
    employee_status: "Active",
    veh_desc: "2021 Chevy Express 2500",
    rental_class: "Cargo Van",
    daily_cost: 85.00,
    cost_delta: null,
    cost_over: false,
    shop_name: "National Fleet Repair",
    shop_po_status: "Awaiting Auth",
    days_open: 14,
    callable: true,
    operator_mark: null,
    mark_at: null
  },
  {
    id: "r8",
    truck_number: "22345",
    tech_name: "David Kim",
    employee_status: "Active",
    veh_desc: "2020 Ram ProMaster",
    rental_class: "Standard Van",
    daily_cost: 70.00,
    cost_delta: null,
    cost_over: false,
    shop_name: "A1 Auto",
    shop_po_status: "Completed",
    days_open: 30,
    callable: true,
    operator_mark: "P",
    mark_at: new Date(Date.now() - 4800000).toISOString()
  },
  {
    id: "r9",
    truck_number: "088554",
    tech_name: "Elena Rossi",
    employee_status: "Active",
    veh_desc: "2018 Ford F-150",
    rental_class: "Pickup",
    daily_cost: 55.00,
    cost_delta: null,
    cost_over: false,
    shop_name: null,
    shop_po_status: null,
    days_open: 4,
    callable: false,
    operator_mark: null,
    mark_at: null
  },
  {
    id: "r10",
    truck_number: "34912",
    tech_name: "James Wilson",
    employee_status: "Active",
    veh_desc: "2023 MB Sprinter",
    rental_class: "High Roof Van",
    daily_cost: 120.00,
    cost_delta: 25.00,
    cost_over: true,
    shop_name: "Sprinter Specialists",
    shop_po_status: "Waiting on Parts",
    days_open: 50,
    callable: true,
    operator_mark: null,
    mark_at: null
  }
];

const money = (n: number) => `$${n.toFixed(2)}`;

// --- Components ---

export function GuidedTriage() {
  // Sort priority: cost overage first, then days open desc
  const queue = useMemo(() => {
    return [...MOCK_DATA].sort((a, b) => {
      if (a.cost_over && !b.cost_over) return -1;
      if (!a.cost_over && b.cost_over) return 1;
      return b.days_open - a.days_open;
    });
  }, []);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'triage' | 'list'>('triage');
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  // Filtered view of the queue that preserves each item's true index in `queue`,
  // so clicking a filtered rail item still focuses the correct rental.
  const visibleQueue = useMemo(() => {
    const q = search.trim().toLowerCase();
    return queue
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) =>
        !q ||
        item.truck_number.toLowerCase().includes(q) ||
        item.tech_name.toLowerCase().includes(q)
      );
  }, [queue, search]);

  const activeRow = queue[currentIndex];

  const handleNext = () => {
    if (currentIndex < queue.length - 1) {
      setCurrentIndex(c => c + 1);
    }
  };

  const handleAction = (actionType: string) => {
    setCompletedIds(prev => new Set(prev).add(activeRow.id));
    handleNext();
  };

  if (!activeRow) return <div className="p-8 text-center text-muted-foreground">Queue completed!</div>;

  return (
    <div className="flex h-screen bg-[#EFF3FA] font-['DM_Sans'] text-[#0F1117]">
      
      {/* Left Sidebar - Queue Rail */}
      <div className="w-[320px] bg-[#101B33] text-white flex flex-col shadow-xl z-10 border-r border-[#223052]">
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between mb-6">
            <h1 className="font-['Syne'] font-bold text-xl tracking-tight">Triage Mode</h1>
            <button 
              onClick={() => setViewMode(viewMode === 'triage' ? 'list' : 'triage')}
              className="text-white/60 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-medium bg-white/5 px-2 py-1 rounded"
            >
              {viewMode === 'triage' ? <List size={14} /> : <ArrowRight size={14} />}
              {viewMode === 'triage' ? 'List View' : 'Triage View'}
            </button>
          </div>
          
          <div className="bg-white/5 rounded-lg p-4 border border-white/10">
            <div className="text-white/60 text-xs font-medium mb-1 uppercase tracking-wider">Today's Progress</div>
            <div className="flex items-end gap-2 mb-2">
              <span className="text-3xl font-light leading-none">{completedIds.size}</span>
              <span className="text-white/40 mb-1">/ {queue.length} reviewed</span>
            </div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div 
                className="h-full bg-[#0EA5E9] rounded-full transition-all duration-500"
                style={{ width: `${(completedIds.size / queue.length) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
          <div className="text-xs font-bold text-white/40 uppercase tracking-wider px-2 mb-3">Up Next</div>
          {visibleQueue.map(({ item, idx }) => {
            const isByovRow = isByov(item.truck_number);
            const isCompleted = completedIds.has(item.id);
            const isActive = idx === currentIndex && viewMode === 'triage';
            
            return (
              <div 
                key={item.id} 
                onClick={() => { setCurrentIndex(idx); setViewMode('triage'); }}
                className={cn(
                  "p-3 rounded-lg cursor-pointer transition-all border",
                  isActive ? "bg-[#1A2540] border-[#5B8BF5]/50 shadow-[0_0_15px_rgba(91,139,245,0.1)]" : "border-transparent hover:bg-white/5",
                  isCompleted && !isActive ? "opacity-40 grayscale" : ""
                )}
              >
                <div className="flex justify-between items-start mb-1">
                  <div className="font-['JetBrains_Mono'] font-medium text-sm flex items-center gap-2">
                    {item.truck_number}
                    {isCompleted && <CheckCircle2 size={12} className="text-[#34D399]" />}
                  </div>
                  {item.cost_over && (
                    <span className="text-[10px] font-bold bg-[#F87171]/20 text-[#FCA5A5] px-1.5 py-0.5 rounded flex items-center gap-1">
                      <AlertTriangle size={10} /> +${item.cost_delta}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs text-white/60">
                  <span className="truncate">{item.tech_name}</span>
                  <span className="flex-shrink-0 ml-2 font-medium">{item.days_open}d open</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        {/* Top search bar area */}
        <div className="h-16 border-b border-[#D6DFEE] bg-white flex items-center px-8 justify-end">
           <div className="relative">
             <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5C6478]" />
             <input 
               type="text" 
               placeholder="Search rentals..." 
               value={search}
               onChange={(e) => setSearch(e.target.value)}
               className="pl-9 pr-4 py-2 bg-[#F8FAFC] border border-[#D6DFEE] rounded-md text-sm w-64 focus:outline-none focus:border-[#1A56DB] transition-colors"
             />
           </div>
        </div>

        {viewMode === 'list' ? (
          <div className="p-8 overflow-y-auto">
            <h2 className="text-xl font-bold font-['Syne'] mb-4">All Pending Rentals</h2>
            <div className="bg-white border border-[#D6DFEE] rounded-lg shadow-sm">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[#D6DFEE] bg-[#F8FAFC]">
                    <th className="p-4 font-medium text-[#5C6478]">Truck</th>
                    <th className="p-4 font-medium text-[#5C6478]">Tech</th>
                    <th className="p-4 font-medium text-[#5C6478]">Days Open</th>
                    <th className="p-4 font-medium text-[#5C6478]">Daily Cost</th>
                    <th className="p-4 font-medium text-[#5C6478]">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleQueue.map(({ item: row, idx: i }) => (
                    <tr key={row.id} className="border-b border-[#D6DFEE] last:border-0 hover:bg-[#F8FAFC] cursor-pointer" onClick={() => { setCurrentIndex(i); setViewMode('triage'); }}>
                      <td className="p-4 font-['JetBrains_Mono']">{row.truck_number}</td>
                      <td className="p-4">{row.tech_name}</td>
                      <td className="p-4">{row.days_open}</td>
                      <td className="p-4">{money(row.daily_cost)}</td>
                      <td className="p-4 text-[#1A56DB] flex items-center gap-1 font-medium"><ArrowRight size={14}/> Triage</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto relative bg-[radial-gradient(#D6DFEE_1px,transparent_1px)] [background-size:24px_24px]">
            {/* Focus Card */}
            <div className="w-full max-w-3xl bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-[#D6DFEE] overflow-hidden flex flex-col transform transition-all duration-300">
              
              {/* Header / Primary Context */}
              <div className="p-8 border-b border-[#D6DFEE] bg-gradient-to-br from-white to-[#F8FAFC]">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-3xl font-bold font-['JetBrains_Mono'] tracking-tight">
                        {activeRow.truck_number}
                      </h2>
                      {isByov(activeRow.truck_number) && (
                        <span className="px-2.5 py-1 bg-[#D9E7F8] text-[#0369A1] text-xs font-bold rounded-md">BYOV</span>
                      )}
                      {activeRow.cost_over && (
                        <span className="px-2.5 py-1 bg-[#F8E0E0] text-[#991B1B] text-xs font-bold rounded-md flex items-center gap-1">
                          <AlertTriangle size={12} /> Cost Overage
                        </span>
                      )}
                    </div>
                    <div className="text-[#5C6478] font-medium flex items-center gap-2">
                      <CarFront size={16} /> {activeRow.veh_desc} · <span className="text-[#0F1117]">{activeRow.rental_class}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-4xl font-light text-[#B45309] mb-1">{activeRow.days_open}<span className="text-lg text-[#5C6478]">d</span></div>
                    <div className="text-xs font-bold text-[#5C6478] uppercase tracking-wider">Days Open</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-6 pt-6 border-t border-[#D6DFEE]">
                  <div>
                    <div className="text-xs text-[#5C6478] mb-1 font-medium flex items-center gap-1.5"><User size={14}/> Technician</div>
                    <div className="font-medium text-[15px]">{activeRow.tech_name}</div>
                    <div className="text-xs mt-0.5 font-medium">
                      {activeRow.employee_status === "Term/Leave" ? 
                        <span className="text-[#DC2626]">Term/Leave</span> : 
                        activeRow.employee_status === "New Hire" ? 
                        <span className="text-[#0D9668]">New Hire</span> : 
                        <span className="text-[#5C6478]">Active Employee</span>}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[#5C6478] mb-1 font-medium flex items-center gap-1.5"><FileText size={14}/> Daily Cost</div>
                    <div className="font-medium text-[15px] font-['JetBrains_Mono']">{money(activeRow.daily_cost)}</div>
                    {activeRow.cost_delta && (
                      <div className="text-xs mt-0.5 text-[#B45309] font-medium">+{money(activeRow.cost_delta)} over median</div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-[#5C6478] mb-1 font-medium flex items-center gap-1.5"><MapPin size={14}/> Repair Shop</div>
                    {isByov(activeRow.truck_number) ? (
                      <div className="italic text-[#5C6478] text-sm">BYOV — repairs not tracked</div>
                    ) : (
                      <>
                        <div className="font-medium text-[15px] truncate">{activeRow.shop_name || "Unknown Shop"}</div>
                        <div className="text-xs mt-0.5 text-[#5C6478]">{activeRow.shop_po_status || "No PO status"}</div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Interaction Panel */}
              <div className="p-8 bg-[#F8FAFC]">
                <h3 className="text-sm font-bold text-[#0F1117] uppercase tracking-wider mb-6">Action Required</h3>
                
                <div className="flex flex-col gap-4">
                  {/* Primary Action */}
                  <button 
                    onClick={() => handleAction('call')}
                    disabled={!activeRow.callable || isByov(activeRow.truck_number)}
                    className="w-full flex items-center justify-between p-5 bg-[#1A56DB] hover:bg-[#1546b5] disabled:bg-[#D6DFEE] disabled:cursor-not-allowed text-white rounded-xl transition-colors shadow-sm group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="bg-white/20 p-3 rounded-lg">
                        <PhoneCall size={24} className={(!activeRow.callable || isByov(activeRow.truck_number)) ? "opacity-50" : ""} />
                      </div>
                      <div className="text-left">
                        <div className="font-bold text-lg">Call with LUCA</div>
                        <div className="text-white/80 text-sm font-medium">
                          {isByov(activeRow.truck_number) ? "Cannot call BYOV rentals" :
                           !activeRow.callable ? "Not callable currently" :
                           `Dispatch AI to call ${activeRow.shop_name || "shop"} for status`}
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={24} className="opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                  </button>

                  {/* Secondary Actions */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center bg-white border border-[#D6DFEE] rounded-xl overflow-hidden shadow-sm h-14">
                      <div className="px-4 text-xs font-bold text-[#5C6478] uppercase bg-[#F1F5F9] h-full flex items-center border-r border-[#D6DFEE]">Mark</div>
                      {['Open', 'Closed', 'Pickup'].map((mark) => {
                        const m = mark[0];
                        const isSelected = activeRow.operator_mark === m;
                        return (
                          <button
                            key={mark}
                            onClick={() => handleAction(`mark_${m}`)}
                            className={cn(
                              "flex-1 h-full text-sm font-bold transition-colors border-r border-[#D6DFEE] last:border-0 hover:bg-[#F8FAFC]",
                              isSelected ? "bg-[#DCE6F9] text-[#1A56DB]" : "text-[#5C6478]"
                            )}
                          >
                            {m}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex gap-4">
                      <button 
                        onClick={() => handleAction('snooze')}
                        className="flex-1 flex items-center justify-center gap-2 bg-white border border-[#D6DFEE] text-[#5C6478] hover:bg-[#F8FAFC] hover:text-[#0F1117] font-bold rounded-xl shadow-sm transition-colors"
                      >
                        <Clock size={16} /> Snooze
                      </button>
                      <button 
                        onClick={() => handleAction('skip')}
                        className="flex-1 flex items-center justify-center gap-2 bg-white border border-[#D6DFEE] text-[#5C6478] hover:bg-[#F8FAFC] hover:text-[#0F1117] font-bold rounded-xl shadow-sm transition-colors"
                      >
                        Skip <SkipForward size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default GuidedTriage;
