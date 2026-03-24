import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Video, FileText, HelpCircle, ChevronRight, Star } from "lucide-react";

const sections = [
  {
    icon: BookOpen,
    title: "Getting Started",
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-900/20",
    items: [
      { label: "Introduction to SHS Nexus", type: "article" },
      { label: "Navigating the Dashboard", type: "video" },
      { label: "Setting Up Your Profile", type: "article" },
    ],
  },
  {
    icon: Video,
    title: "Fleet Management",
    color: "text-violet-500",
    bg: "bg-violet-50 dark:bg-violet-900/20",
    items: [
      { label: "Managing Vehicles", type: "video" },
      { label: "DTC Alerts & Telematics", type: "article" },
      { label: "Fleet Scope Overview", type: "video" },
    ],
  },
  {
    icon: FileText,
    title: "Onboarding & Offboarding",
    color: "text-green-500",
    bg: "bg-green-50 dark:bg-green-900/20",
    items: [
      { label: "Weekly Onboarding Workflow", type: "article" },
      { label: "Tech Roster Management", type: "video" },
      { label: "Offboarding Checklist", type: "article" },
    ],
  },
  {
    icon: HelpCircle,
    title: "TPMS & Parts",
    color: "text-orange-500",
    bg: "bg-orange-50 dark:bg-orange-900/20",
    items: [
      { label: "TPMS Tech Profile Search", type: "article" },
      { label: "Shipping Addresses Guide", type: "article" },
      { label: "Managing Shipping Schedules", type: "video" },
    ],
  },
];

export default function Tutorial() {
  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Help & Tutorials</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Learn how to use SHS Nexus with step-by-step guides and video walkthroughs.
        </p>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-4 flex items-center gap-4">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Star className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm">New to Nexus?</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Start with the "Getting Started" section to learn the basics of the platform.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {sections.map(({ icon: Icon, title, color, bg, items }) => (
          <Card key={title}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <div className={`h-8 w-8 rounded-lg ${bg} flex items-center justify-center`}>
                  <Icon className={`h-4 w-4 ${color}`} />
                </div>
                {title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              {items.map(({ label, type }) => (
                <button
                  key={label}
                  className="w-full flex items-center justify-between p-2.5 rounded-md hover:bg-muted transition-colors text-left group"
                >
                  <div className="flex items-center gap-2.5">
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 ${type === "video" ? "border-violet-300 text-violet-600 dark:text-violet-400" : "border-blue-300 text-blue-600 dark:text-blue-400"}`}
                    >
                      {type === "video" ? "VIDEO" : "ARTICLE"}
                    </Badge>
                    <span className="text-sm">{label}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-4 text-center space-y-2 py-8">
          <HelpCircle className="h-8 w-8 mx-auto text-muted-foreground opacity-50" />
          <p className="font-medium text-sm">Need more help?</p>
          <p className="text-xs text-muted-foreground">
            Contact your district manager or reach out to the Nexus support team.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
