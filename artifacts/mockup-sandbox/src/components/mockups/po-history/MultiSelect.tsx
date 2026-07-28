import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

interface MultiSelectProps {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  width?: string;
}

export function MultiSelect({ label, options, selected, onChange, width = "w-40" }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const allSelected = selected.size === 0 || selected.size === options.length;

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange(next.size === options.length ? new Set() : next);
  };

  const toggleAll = () => {
    onChange(new Set());
  };

  const isChecked = (value: string) => selected.size === 0 || selected.has(value);

  const triggerLabel = (() => {
    if (selected.size === 0 || selected.size === options.length) return `All ${label}`;
    if (selected.size === 1) return options.find(o => selected.has(o.value))?.label ?? `1 ${label}`;
    return `${selected.size} ${label}`;
  })();

  return (
    <div ref={ref} className={`relative ${width}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full h-9 flex items-center justify-between gap-2 px-3 text-sm bg-zinc-950 border border-zinc-800 rounded-md text-zinc-300 hover:border-zinc-700 hover:text-zinc-100 transition-colors"
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[160px] bg-zinc-900 border border-zinc-700 rounded-md shadow-xl overflow-hidden">
          <button
            onClick={toggleAll}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-zinc-800 transition-colors border-b border-zinc-800"
          >
            <span className={`flex items-center justify-center w-4 h-4 rounded border ${allSelected ? "bg-indigo-600 border-indigo-600" : "border-zinc-600 bg-transparent"}`}>
              {allSelected && <Check className="w-2.5 h-2.5 text-white" />}
            </span>
            <span className="text-zinc-300 font-medium">All {label}</span>
          </button>
          {options.map(opt => {
            const checked = isChecked(opt.value);
            return (
              <button
                key={opt.value}
                onClick={() => toggle(opt.value)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-zinc-800 transition-colors"
              >
                <span className={`flex items-center justify-center w-4 h-4 rounded border ${checked ? "bg-indigo-600 border-indigo-600" : "border-zinc-600 bg-transparent"}`}>
                  {checked && <Check className="w-2.5 h-2.5 text-white" />}
                </span>
                <span className={checked ? "text-zinc-200" : "text-zinc-400"}>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
