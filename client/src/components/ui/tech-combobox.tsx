import { useState, useEffect, useCallback, useMemo } from "react";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useQuery } from "@tanstack/react-query";

export interface TechRosterEntry {
  id: string;
  employeeId: string;
  techRacfid: string;
  techName: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  districtNo?: string;
  planningAreaName?: string;
  employmentStatus?: string;
}

interface TechComboboxProps {
  value: string;
  onSelect: (tech: TechRosterEntry | null) => void;
  searchField: "employeeId" | "techRacfid" | "techName";
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function TechCombobox({
  value,
  onSelect,
  searchField,
  placeholder = "Search Employee...",
  disabled = false,
  className,
  "data-testid": dataTestId,
}: TechComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: techs = [], isLoading } = useQuery<TechRosterEntry[]>({
    queryKey: ["/api/all-techs"],
    staleTime: 5 * 60 * 1000,
  });

  const getDisplayValue = useCallback((tech: TechRosterEntry) => {
    switch (searchField) {
      case "employeeId":
        return tech.employeeId;
      case "techRacfid":
        return tech.techRacfid;
      case "techName":
        return tech.techName;
      default:
        return "";
    }
  }, [searchField]);

  const filteredTechs = useMemo(() => {
    if (!searchQuery) return techs.slice(0, 100);
    
    const query = searchQuery.toLowerCase();
    return techs.filter(tech => {
      const employeeMatch = tech.employeeId?.toLowerCase().includes(query);
      const racfidMatch = tech.techRacfid?.toLowerCase().includes(query);
      const nameMatch = tech.techName?.toLowerCase().includes(query);
      return employeeMatch || racfidMatch || nameMatch;
    }).slice(0, 100);
  }, [techs, searchQuery]);

  const selectedTech = useMemo(() => {
    if (!value) return null;
    return techs.find(tech => getDisplayValue(tech) === value) || null;
  }, [techs, value, getDisplayValue]);

  const getFieldLabel = () => {
    switch (searchField) {
      case "employeeId":
        return "Employee ID";
      case "techRacfid":
        return "RACF ID";
      case "techName":
        return "Name";
      default:
        return "";
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground",
            className
          )}
          disabled={disabled || isLoading}
          data-testid={dataTestId}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </span>
          ) : value ? (
            <span className="truncate">{value}</span>
          ) : (
            placeholder
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[350px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={`Search by ID, RACF ID, or name...`}
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            <CommandEmpty>
              {isLoading ? "Loading Employees..." : "No Employee found."}
            </CommandEmpty>
            <CommandGroup heading={`Select ${getFieldLabel()}`}>
              {filteredTechs.map((tech) => (
                <CommandItem
                  key={tech.id}
                  value={tech.id}
                  onSelect={() => {
                    onSelect(tech);
                    setOpen(false);
                    setSearchQuery("");
                  }}
                  className="flex flex-col items-start py-2"
                >
                  <div className="flex items-center w-full">
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedTech?.id === tech.id
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{tech.techName}</div>
                      <div className="text-xs text-muted-foreground flex gap-2">
                        <span>ID: {tech.employeeId}</span>
                        <span>•</span>
                        <span>RACF: {tech.techRacfid}</span>
                      </div>
                      {tech.jobTitle && (
                        <div className="text-xs text-muted-foreground truncate">
                          {tech.jobTitle}
                        </div>
                      )}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            {filteredTechs.length >= 100 && (
              <div className="p-2 text-xs text-center text-muted-foreground border-t">
                Showing first 100 results. Type to narrow search.
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
