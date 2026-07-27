import './_group.css';
import React, { useState, useMemo } from 'react';
import { Search, PhoneCall, AlertCircle, TrendingUp, Info } from 'lucide-react';

const fonts = {
  syne: "'Syne', sans-serif",
  dmSans: "'DM Sans', sans-serif",
  jetbrains: "'JetBrains Mono', monospace",
};

const colors = {
  background: "var(--vrm-background)",
  surface: "var(--vrm-surface)",
  ink: "var(--vrm-ink)",
  inkSoft: "var(--vrm-ink-soft)",
  inkMuted: "var(--vrm-ink-muted)",
  rule: "var(--vrm-rule)",
  accent: "var(--vrm-accent)",
  accentLight: "var(--vrm-accent-light)",
  green: "var(--vrm-green)",
  greenLight: "var(--vrm-green-light)",
  amber: "var(--vrm-amber)",
  amberLight: "var(--vrm-amber-light)",
  red: "var(--vrm-red)",
  redLight: "var(--vrm-red-light)",
  redDeep: "var(--vrm-red-deep)",
  blue: "var(--vrm-blue)",
  blueLight: "var(--vrm-blue-light)",
};

interface RentalRecord {
  id: string;
  truckNumber: string;
  techName: string;
  techStatus: 'Active' | 'New Hire' | 'Term/Leave';
  vehDesc: string;
  rentalClass: string;
  dailyCost: number;
  costDelta?: number; // Cost overage
  shopName: string | null;
  poStatus: string | null;
  daysOpen: number;
  lastActivity: string;
  operatorMark: 'Open' | 'Closed' | 'Pickup' | null;
  callable: boolean;
}

const mockRentals: RentalRecord[] = [
  { id: '1', truckNumber: '61385', techName: 'John Smith', techStatus: 'Active', vehDesc: 'Ford Explorer', rentalClass: 'Premium SUV', dailyCost: 115.50, costDelta: 20.50, shopName: 'Bob\'s Auto', poStatus: 'Awaiting Parts', daysOpen: 42, lastActivity: 'Called shop, parts arriving tomorrow.', operatorMark: 'Open', callable: true },
  { id: '2', truckNumber: '82041', techName: 'Jane Doe', techStatus: 'Term/Leave', vehDesc: 'Chevy Transit', rentalClass: 'Standard Van', dailyCost: 65.00, shopName: 'City Garage', poStatus: null, daysOpen: 7, lastActivity: 'No answer.', operatorMark: null, callable: false },
  { id: '3', truckNumber: '40192', techName: 'Bob Brown', techStatus: 'Active', vehDesc: 'Dodge Silverado', rentalClass: 'Heavy Duty', dailyCost: 140.00, costDelta: 30.00, shopName: 'Fleet Services Inc', poStatus: 'Approved', daysOpen: 26, lastActivity: 'Repair pending auth.', operatorMark: 'Open', callable: true },
  { id: '4', truckNumber: '99214', techName: 'Alice White', techStatus: 'Active', vehDesc: 'Nissan Promaster', rentalClass: 'Cargo Van', dailyCost: 72.00, shopName: 'Quick Fix', poStatus: 'Completed', daysOpen: 17, lastActivity: 'Tech to pick up today.', operatorMark: 'Pickup', callable: true },
  { id: '5', truckNumber: '88217', techName: 'Luis Herrera', techStatus: 'Active', vehDesc: 'Personal Minivan', rentalClass: 'Cargo Van', dailyCost: 46.00, shopName: null, poStatus: null, daysOpen: 11, lastActivity: 'Logged in system.', operatorMark: 'Open', callable: false },
  { id: '6', truckNumber: '50122', techName: 'Charlie Davis', techStatus: 'New Hire', vehDesc: 'Ford Transit', rentalClass: 'Standard Van', dailyCost: 68.00, shopName: 'Midas', poStatus: 'Estimating', daysOpen: 3, lastActivity: 'Waiting on shop quote.', operatorMark: 'Open', callable: true },
  { id: '7', truckNumber: '30291', techName: 'Eva Green', techStatus: 'Active', vehDesc: 'Chevy Tahoe', rentalClass: 'Standard SUV', dailyCost: 85.00, shopName: 'Pep Boys', poStatus: 'Awaiting Parts', daysOpen: 15, lastActivity: 'Shop waiting on alternator.', operatorMark: 'Open', callable: true },
  { id: '8', truckNumber: '71004', techName: 'Frank Miller', techStatus: 'Active', vehDesc: 'Toyota NV200', rentalClass: 'Cargo Van', dailyCost: 70.00, shopName: 'Downtown Auto', poStatus: 'Completed', daysOpen: 5, lastActivity: 'Ready for pickup.', operatorMark: 'Pickup', callable: true },
  { id: '9', truckNumber: '11055', techName: 'Grace Lee', techStatus: 'Active', vehDesc: 'Ford Explorer', rentalClass: 'Premium SUV', dailyCost: 95.00, shopName: 'Local Mechanic', poStatus: 'Approved', daysOpen: 22, lastActivity: 'Repair started.', operatorMark: 'Open', callable: true },
  { id: '10', truckNumber: '29011', techName: 'Harry Wilson', techStatus: 'Active', vehDesc: 'Chevy Express', rentalClass: 'Standard Van', dailyCost: 60.00, shopName: 'Jiffy Lube', poStatus: 'Estimating', daysOpen: 30, lastActivity: 'Follow up required.', operatorMark: 'Open', callable: true },
  { id: '11', truckNumber: '88450', techName: 'Ian Moore', techStatus: 'Active', vehDesc: 'Personal Pickup', rentalClass: 'Truck', dailyCost: 50.00, shopName: null, poStatus: null, daysOpen: 8, lastActivity: 'Checked status.', operatorMark: 'Open', callable: false },
  { id: '12', truckNumber: '31502', techName: 'Julia Taylor', techStatus: 'Active', vehDesc: 'Ford F-150', rentalClass: 'Standard Truck', dailyCost: 88.00, shopName: 'Westside Repair', poStatus: 'Awaiting Parts', daysOpen: 45, lastActivity: 'Parts delayed another week.', operatorMark: 'Open', callable: true },
  { id: '13', truckNumber: '42688', techName: 'Kevin Anderson', techStatus: 'Active', vehDesc: 'GMC Savana', rentalClass: 'Cargo Van', dailyCost: 75.00, shopName: 'Pro Auto', poStatus: 'Completed', daysOpen: 12, lastActivity: 'Vehicle repaired.', operatorMark: 'Closed', callable: true },
];

function isByov(truckNo: string) {
  const raw = String(truckNo).trim();
  return raw.startsWith('88') || raw.startsWith('088');
}

function formatMoney(num: number) {
  return `$${num.toFixed(2)}`;
}

export function CostCommand() {
  const [search, setSearch] = useState('');

  const sortedRentals = useMemo(() => {
    return [...mockRentals].sort((a, b) => b.dailyCost - a.dailyCost);
  }, []);

  const filteredRentals = useMemo(() => {
    return sortedRentals.filter(r => {
      if (!search) return true;
      const q = search.toLowerCase();
      return r.truckNumber.toLowerCase().includes(q) || r.techName.toLowerCase().includes(q);
    });
  }, [sortedRentals, search]);

  const top5Ids = useMemo(() => {
    return new Set(sortedRentals.slice(0, 5).map(r => r.truckNumber));
  }, [sortedRentals]);

  const { totalDailyBurn, overageBurn, top5Burn } = useMemo(() => {
    let t = 0;
    let o = 0;
    mockRentals.forEach(r => {
      t += r.dailyCost;
      if (r.costDelta) o += r.costDelta;
    });
    
    let top5 = 0;
    sortedRentals.slice(0, 5).forEach(r => top5 += r.dailyCost);

    return { totalDailyBurn: t, overageBurn: o, top5Burn: top5 };
  }, [sortedRentals]);

  const maxCost = useMemo(() => {
    return Math.max(...mockRentals.map(r => r.dailyCost));
  }, []);

  return (
    <div className="min-h-screen" style={{ backgroundColor: colors.background, color: colors.ink, fontFamily: fonts.dmSans }}>
      {/* Top Navigation */}
      <header className="px-6 py-4 flex items-center justify-between" style={{ backgroundColor: colors.surface, borderBottom: `1px solid ${colors.rule}` }}>
        <div>
          <h1 className="text-xl font-bold m-0 flex items-center gap-2" style={{ fontFamily: fonts.syne }}>
            <TrendingUp size={20} style={{ color: colors.red }} />
            Cost Command Center
          </h1>
          <p className="text-sm mt-1" style={{ color: colors.inkMuted }}>
            Optimizing fleet spend by ranking rentals by daily cost impact.
          </p>
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-2.5" style={{ color: colors.inkMuted }} />
          <input
            type="text"
            placeholder="Search truck or tech..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm rounded-md outline-none focus:ring-2"
            style={{ border: `1px solid ${colors.rule}`, width: '260px', backgroundColor: '#fff' }}
          />
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        
        {/* KPI Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="p-5 rounded-lg shadow-sm" style={{ backgroundColor: '#fff', border: `1px solid ${colors.rule}` }}>
            <div className="text-sm font-semibold uppercase tracking-wider mb-1" style={{ color: colors.inkMuted }}>Total Daily Burn</div>
            <div className="text-4xl font-bold" style={{ fontFamily: fonts.jetbrains, color: colors.ink }}>
              {formatMoney(totalDailyBurn)}
            </div>
            <div className="text-xs mt-2" style={{ color: colors.inkMuted }}>
              Across {mockRentals.length} open rentals. Projected: <strong style={{ color: colors.ink }}>{formatMoney(totalDailyBurn * 30)}/mo</strong>
            </div>
          </div>
          
          <div className="p-5 rounded-lg shadow-sm" style={{ backgroundColor: colors.redLight, border: `1px solid #fecaca` }}>
            <div className="text-sm font-semibold uppercase tracking-wider mb-1" style={{ color: colors.redDeep }}>Overage Burn</div>
            <div className="text-4xl font-bold flex items-baseline gap-2" style={{ fontFamily: fonts.jetbrains, color: colors.red }}>
              {formatMoney(overageBurn)}
              <span className="text-sm font-medium">/ day</span>
            </div>
            <div className="text-xs mt-2" style={{ color: colors.redDeep }}>
              Money leaking from off-contract rates.
            </div>
          </div>

          <div className="p-5 rounded-lg shadow-sm" style={{ backgroundColor: '#fff', border: `1px solid ${colors.rule}` }}>
            <div className="text-sm font-semibold uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: colors.inkMuted }}>
              Top 5 Impact <Info size={14} />
            </div>
            <div className="text-4xl font-bold" style={{ fontFamily: fonts.jetbrains, color: colors.ink }}>
              {formatMoney(top5Burn)}
            </div>
            <div className="text-xs mt-2" style={{ color: colors.inkMuted }}>
              Fixing the top 5 saves <strong style={{ color: colors.ink }}>{Math.round((top5Burn / totalDailyBurn) * 100)}%</strong> of daily spend.
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="rounded-lg overflow-hidden shadow-sm" style={{ backgroundColor: '#fff', border: `1px solid ${colors.rule}` }}>
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr style={{ backgroundColor: colors.surface, borderBottom: `1px solid ${colors.rule}` }}>
                <th className="py-3 px-4 font-semibold">Cost Impact</th>
                <th className="py-3 px-4 font-semibold">Truck & Tech</th>
                <th className="py-3 px-4 font-semibold">Vehicle</th>
                <th className="py-3 px-4 font-semibold">Shop & Status</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRentals.map((rental) => {
                const isByovRow = isByov(rental.truckNumber);
                const costWidth = Math.max(10, (rental.dailyCost / maxCost) * 100);
                const top5 = top5Ids.has(rental.truckNumber);

                return (
                  <tr key={rental.id} style={{ borderBottom: `1px solid ${colors.rule}` }} className="hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-4 align-top w-1/4">
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="text-lg font-bold" style={{ fontFamily: fonts.jetbrains, color: rental.costDelta ? colors.red : colors.ink }}>
                          {formatMoney(rental.dailyCost)}<span className="text-xs text-gray-500 font-normal">/d</span>
                        </span>
                        {rental.costDelta && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1" style={{ backgroundColor: colors.redLight, color: colors.red }}>
                            <AlertCircle size={10} /> +{formatMoney(rental.costDelta)} overage
                          </span>
                        )}
                        {!rental.costDelta && top5 && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: colors.amberLight, color: colors.amber }}>
                            Top 5
                          </span>
                        )}
                      </div>
                      <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: colors.rule }}>
                        <div 
                          className="h-full rounded-full" 
                          style={{ 
                            width: `${costWidth}%`, 
                            backgroundColor: rental.costDelta ? colors.red : (top5 ? colors.amber : colors.accent) 
                          }} 
                        />
                      </div>
                      <div className="text-xs mt-1 font-medium" style={{ color: colors.inkMuted }}>
                        {rental.daysOpen} days open = <span style={{ fontFamily: fonts.jetbrains }}>{formatMoney(rental.dailyCost * rental.daysOpen)}</span> total so far
                      </div>
                    </td>
                    
                    <td className="py-4 px-4 align-top">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold font-mono" style={{ fontFamily: fonts.jetbrains }}>{rental.truckNumber}</span>
                        {isByovRow && (
                          <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: colors.blueLight, color: colors.blue }}>BYOV</span>
                        )}
                      </div>
                      <div className="font-medium">{rental.techName}</div>
                      {rental.techStatus !== 'Active' && (
                        <div className="inline-block mt-1 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: rental.techStatus === 'Term/Leave' ? colors.redLight : colors.greenLight, color: rental.techStatus === 'Term/Leave' ? colors.red : colors.green }}>
                          {rental.techStatus}
                        </div>
                      )}
                    </td>

                    <td className="py-4 px-4 align-top">
                      <div className="font-medium text-gray-900">{rental.vehDesc}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{rental.rentalClass}</div>
                    </td>

                    <td className="py-4 px-4 align-top">
                      {isByovRow ? (
                        <div className="italic text-gray-400 text-xs mt-1">BYOV — repairs not tracked</div>
                      ) : (
                        <>
                          <div className="font-medium">{rental.shopName || "Unknown Shop"}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{rental.poStatus || "No PO Status"}</div>
                          <div className="text-xs text-gray-400 mt-2 truncate max-w-[200px]" title={rental.lastActivity}>
                            Last: {rental.lastActivity}
                          </div>
                        </>
                      )}
                    </td>

                    <td className="py-4 px-4 align-top text-right">
                      <div className="flex flex-col items-end gap-2">
                        <button 
                          disabled={!rental.callable || isByovRow}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors w-[120px]"
                          style={{ 
                            backgroundColor: (rental.callable && !isByovRow) ? colors.accent : colors.rule, 
                            color: (rental.callable && !isByovRow) ? '#fff' : colors.inkMuted,
                            cursor: (rental.callable && !isByovRow) ? 'pointer' : 'not-allowed'
                          }}
                        >
                          <PhoneCall size={14} /> Call LUCA
                        </button>
                        
                        <div className="flex items-center rounded-md overflow-hidden border w-[120px]" style={{ borderColor: colors.rule }}>
                          {(['Open', 'Closed', 'Pickup'] as const).map(mark => (
                            <button
                              key={mark}
                              className="flex-1 py-1 text-xs font-semibold text-center transition-colors"
                              style={{
                                backgroundColor: rental.operatorMark === mark ? colors.accentLight : '#fff',
                                color: rental.operatorMark === mark ? colors.accent : colors.inkMuted,
                                borderRight: mark !== 'Pickup' ? `1px solid ${colors.rule}` : 'none'
                              }}
                            >
                              {mark[0]}
                            </button>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
              
              {filteredRentals.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-500">
                    No rentals found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

export default CostCommand;
