import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, Search, X } from "lucide-react";

interface MultiSelectFilterProps {
  options: string[];
  selectedValues: string[];
  onSelectionChange: (values: string[]) => void;
  placeholder?: string;
  label?: string;
  showSearch?: boolean;
  className?: string;
  optionColors?: Record<string, string>;
}

export function MultiSelectFilter({
  options,
  selectedValues,
  onSelectionChange,
  placeholder = "Select...",
  label,
  showSearch = true,
  className = "",
  optionColors,
}: MultiSelectFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredOptions = options.filter((option) =>
    option.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Special marker to indicate "none selected" state
  const NONE_MARKER = "__NONE_SELECTED__";
  const isNoneSelected = selectedValues.length === 1 && selectedValues[0] === NONE_MARKER;
  const allSelected = selectedValues.length === 0 || selectedValues.length === options.length;
  const isAllChecked = selectedValues.length === 0;

  const handleSelectAll = () => {
    if (isAllChecked) {
      // Currently all selected, so deselect all
      onSelectionChange([NONE_MARKER]);
    } else {
      // Select all
      onSelectionChange([]);
    }
  };

  const handleOptionToggle = (option: string) => {
    // If none are selected, clicking an option selects just that one
    if (isNoneSelected) {
      onSelectionChange([option]);
      return;
    }
    
    if (selectedValues.length === 0) {
      // All selected, deselect this one option
      const allExceptOption = options.filter((o) => o !== option);
      onSelectionChange(allExceptOption);
    } else if (selectedValues.includes(option)) {
      const newValues = selectedValues.filter((v) => v !== option);
      if (newValues.length === 0) {
        // Last item unchecked, go to "none selected" state
        onSelectionChange([NONE_MARKER]);
      } else if (newValues.length === options.length) {
        onSelectionChange([]);
      } else {
        onSelectionChange(newValues);
      }
    } else {
      const newValues = [...selectedValues, option];
      if (newValues.length === options.length) {
        onSelectionChange([]);
      } else {
        onSelectionChange(newValues);
      }
    }
  };

  const isOptionSelected = (option: string) => {
    if (isNoneSelected) return false;
    if (selectedValues.length === 0) return true;
    return selectedValues.includes(option);
  };

  const getDisplayText = () => {
    if (isNoneSelected) {
      return "None";
    }
    if (selectedValues.length === 0 || selectedValues.length === options.length) {
      return "All";
    }
    if (selectedValues.length === 1) {
      return selectedValues[0];
    }
    return `${selectedValues.length} selected`;
  };

  useEffect(() => {
    if (isOpen && inputRef.current && showSearch) {
      inputRef.current.focus();
    }
    if (!isOpen) {
      setSearchQuery("");
    }
  }, [isOpen, showSearch]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`h-7 text-xs font-normal justify-between gap-1 ${className}`}
          data-testid={`filter-trigger-${label?.toLowerCase().replace(/\s+/g, '-') || 'multi-select'}`}
        >
          <span className="truncate max-w-[100px] flex items-center gap-1">
            {optionColors && selectedValues.length === 1 && !isNoneSelected && optionColors[selectedValues[0]] && (
              <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${optionColors[selectedValues[0]]}`} />
            )}
            {getDisplayText()}
          </span>
          <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-[220px] p-0" 
        align="start"
        data-testid={`filter-popover-${label?.toLowerCase().replace(/\s+/g, '-') || 'multi-select'}`}
      >
        <div className="p-2 border-b">
          {showSearch && (
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="h-7 pl-7 text-xs"
                data-testid="filter-search-input"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                >
                  <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>
          )}
        </div>
        
        <ScrollArea className="h-[200px]">
          <div className="p-1">
            <label
              className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover-elevate cursor-pointer"
              data-testid="filter-option-select-all"
            >
              <Checkbox
                checked={isAllChecked && !isNoneSelected}
                onCheckedChange={handleSelectAll}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium">(Select All)</span>
            </label>
            
            {filteredOptions.length === 0 ? (
              <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                No options found
              </div>
            ) : (
              filteredOptions.map((option) => (
                <label
                  key={option}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover-elevate cursor-pointer"
                  data-testid={`filter-option-${option.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <Checkbox
                    checked={isOptionSelected(option)}
                    onCheckedChange={() => handleOptionToggle(option)}
                    className="h-4 w-4"
                  />
                  {optionColors?.[option] ? (
                    <span className="flex items-center gap-1.5 text-sm truncate">
                      <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${optionColors[option]}`} />
                      {option}
                    </span>
                  ) : (
                    <span className="text-sm truncate">{option}</span>
                  )}
                </label>
              ))
            )}
          </div>
        </ScrollArea>

        <div className="p-2 border-t flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setIsOpen(false)}
            data-testid="filter-cancel-button"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => setIsOpen(false)}
            data-testid="filter-ok-button"
          >
            OK
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
