import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, Truck } from "lucide-react";
import { useUser } from "@/context/UserContext";

const PRESET_USERS = [
  "Oscar S",
  "Rob A",
  "Bob B",
  "John C",
  "Mandy R",
  "Luca B",
  "Samantha W",
  "Sean C",
  "Andrei D",
  "Cheryl G",
  "Anitha P",
  "Sandeep K",
  "Rakesh S",
  "Utsav P",
  "Carol C",
  "Rob Del",
  "Olga F",
];

export default function ProfileSelection() {
  const [, setLocation] = useLocation();
  const { setCurrentUser } = useUser();
  const [selectedPreset, setSelectedPreset] = useState<string>("");
  const [customName, setCustomName] = useState<string>("");

  const handleContinue = () => {
    const name = customName.trim() || selectedPreset;
    if (name) {
      setCurrentUser(name);
      setLocation("/");
    }
  };

  const isValid = !!(customName.trim() || selectedPreset);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Truck className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Fleet Scope</CardTitle>
          <CardDescription className="text-base mt-2">
            Select your name to continue. Your actions will be tracked in the system.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-4">
          <div className="space-y-2">
            <Label htmlFor="preset-user">Select your name</Label>
            <Select 
              value={selectedPreset} 
              onValueChange={(value) => {
                setSelectedPreset(value);
                setCustomName("");
              }}
            >
              <SelectTrigger id="preset-user" data-testid="select-preset-user">
                <SelectValue placeholder="Choose from list..." />
              </SelectTrigger>
              <SelectContent>
                {PRESET_USERS.map((name) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-name">Enter your name</Label>
            <Input
              id="custom-name"
              placeholder="Type your name..."
              value={customName}
              onChange={(e) => {
                setCustomName(e.target.value);
                if (e.target.value.trim()) {
                  setSelectedPreset("");
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isValid) {
                  handleContinue();
                }
              }}
              data-testid="input-custom-name"
            />
          </div>

          <Button 
            className="w-full" 
            size="lg"
            onClick={handleContinue}
            disabled={!isValid}
            data-testid="button-continue"
          >
            <User className="w-4 h-4 mr-2" />
            Continue as {customName.trim() || selectedPreset || "..."}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
