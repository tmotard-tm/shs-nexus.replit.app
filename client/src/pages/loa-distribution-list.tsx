import { useState, useEffect } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LoaTeamRecipients } from "@shared/schema";
import { Mail, Plus, X, Loader2, Lock, Users } from "lucide-react";

const TEAMS: { key: string; label: string; description: string }[] = [
  { key: "fleet", label: "Fleet", description: "Vehicle recovery & telematics team" },
  { key: "assets", label: "Assets", description: "Company assets & equipment team" },
  { key: "inventory", label: "Inventory", description: "Parts & inventory team" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function TeamCard({
  team,
  label,
  description,
  emails,
  canEdit,
  onSave,
  saving,
}: {
  team: string;
  label: string;
  description: string;
  emails: string[];
  canEdit: boolean;
  onSave: (team: string, emails: string[]) => void;
  saving: boolean;
}) {
  const [local, setLocal] = useState<string[]>(emails);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocal(emails);
  }, [emails]);

  const dirty = JSON.stringify(local) !== JSON.stringify(emails);

  const addEmail = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (!EMAIL_RE.test(trimmed)) {
      setError(`"${trimmed}" is not a valid email address.`);
      return;
    }
    if (local.includes(trimmed)) {
      setError(`"${trimmed}" is already on the list.`);
      return;
    }
    setLocal([...local, trimmed]);
    setDraft("");
    setError(null);
  };

  const removeEmail = (email: string) => {
    setLocal(local.filter((e) => e !== email));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          {label} Team
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 min-h-[2rem]">
          {local.length === 0 && (
            <span className="text-sm italic text-muted-foreground">No recipients configured.</span>
          )}
          {local.map((email) => (
            <Badge key={email} variant="secondary" className="gap-1.5 py-1 pl-3 pr-1.5 text-sm">
              {email}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => removeEmail(email)}
                  className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                  aria-label={`Remove ${email}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </Badge>
          ))}
        </div>

        {canEdit && (
          <>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="name@company.com"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addEmail();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addEmail}>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              {dirty && (
                <Button type="button" variant="ghost" onClick={() => setLocal(emails)} disabled={saving}>
                  Reset
                </Button>
              )}
              <Button
                type="button"
                onClick={() => onSave(team, local)}
                disabled={!dirty || saving}
              >
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function LoaDistributionList() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canEdit = user?.role === "developer" || user?.role === "admin";
  const [savingTeam, setSavingTeam] = useState<string | null>(null);

  const { data: recipients = [], isLoading } = useQuery<LoaTeamRecipients[]>({
    queryKey: ["/api/loa/distribution-list"],
  });

  const emailsForTeam = (team: string): string[] => {
    const row = recipients.find((r) => r.team === team);
    return (row?.emails as string[] | null) ?? [];
  };

  const saveMutation = useMutation({
    mutationFn: async ({ team, emails }: { team: string; emails: string[] }) => {
      const res = await apiRequest("PUT", "/api/loa/distribution-list", { team, emails });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/loa/distribution-list"] });
      toast({ title: "Saved", description: `${vars.team} distribution list updated.` });
      setSavingTeam(null);
    },
    onError: (err: any) => {
      toast({
        title: "Failed to save",
        description: err?.message || "Could not update the distribution list.",
        variant: "destructive",
      });
      setSavingTeam(null);
    },
  });

  const handleSave = (team: string, emails: string[]) => {
    setSavingTeam(team);
    saveMutation.mutate({ team, emails });
  };

  return (
    <MainContent>
      <TopBar
        title="LOA Distribution List"
        breadcrumbs={["Home", "Management", "LOA Distribution List"]}
      />

      <main className="p-6 space-y-6 max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              LOA Team Email Recipients
            </CardTitle>
            <CardDescription>
              These addresses receive the automated LOA team notice (3 working days before a leave begins)
              and the return notice (3 working days before the expected return). Tech SMS goes to the
              technician directly and is configured separately.
            </CardDescription>
          </CardHeader>
          {!canEdit && (
            <CardContent>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Lock className="h-4 w-4" />
                You can view the distribution list, but editing requires a developer or admin role.
              </div>
            </CardContent>
          )}
        </Card>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading distribution list…
          </div>
        ) : (
          <div className="space-y-4">
            {TEAMS.map((t) => (
              <TeamCard
                key={t.key}
                team={t.key}
                label={t.label}
                description={t.description}
                emails={emailsForTeam(t.key)}
                canEdit={canEdit}
                onSave={handleSave}
                saving={saveMutation.isPending && savingTeam === t.key}
              />
            ))}
          </div>
        )}
      </main>
    </MainContent>
  );
}
