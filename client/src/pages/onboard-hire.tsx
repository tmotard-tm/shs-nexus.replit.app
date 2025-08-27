import { useState } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, CheckCircle, Clock, Users } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";

export default function OnboardHire() {
  const { toast } = useToast();
  const [employeeForm, setEmployeeForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    department: "",
    position: "",
    startDate: "",
    manager: "",
    employeeId: "",
    emergencyContact: "",
    emergencyPhone: ""
  });

  const [onboardingTasks, setOnboardingTasks] = useState([
    { id: "background-check", label: "Background Check", completed: false },
    { id: "equipment-assignment", label: "Equipment Assignment", completed: false },
    { id: "system-access", label: "System Access Setup", completed: false },
    { id: "workspace-setup", label: "Workspace Setup", completed: false },
    { id: "orientation-scheduled", label: "Orientation Scheduled", completed: false },
    { id: "documentation", label: "Documentation Completed", completed: false }
  ]);

  const departments = [
    "Human Resources",
    "Sales", 
    "Marketing",
    "Operations",
    "Finance",
    "IT",
    "Customer Service"
  ];

  const managers = [
    { id: "1", name: "Sarah Johnson", department: "Sales" },
    { id: "2", name: "Mike Chen", department: "Operations" },
    { id: "3", name: "Emily Davis", department: "Marketing" },
    { id: "4", name: "Robert Wilson", department: "Finance" }
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Employee Onboarded",
      description: `${employeeForm.firstName} ${employeeForm.lastName} has been successfully added to the system`,
    });
    
    setEmployeeForm({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      department: "",
      position: "",
      startDate: "",
      manager: "",
      employeeId: "",
      emergencyContact: "",
      emergencyPhone: ""
    });

    setOnboardingTasks(tasks => tasks.map(task => ({ ...task, completed: false })));
  };

  const toggleTask = (taskId: string) => {
    setOnboardingTasks(tasks => 
      tasks.map(task => 
        task.id === taskId ? { ...task, completed: !task.completed } : task
      )
    );
  };

  const completedTasks = onboardingTasks.filter(task => task.completed).length;
  const totalTasks = onboardingTasks.length;

  return (
    <div className="flex-1">
      <TopBar 
        title="Onboard New Hire" 
        breadcrumbs={["Home", "Onboard"]}
      />
      
      <main className="p-6">
        <div className="max-w-7xl mx-auto">
          <BackButton href="/" />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Employee Information Form */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2" data-testid="text-employee-info-title">
                    <UserPlus className="h-5 w-5" />
                    Employee Information
                  </CardTitle>
                  <CardDescription>
                    Enter the new employee's personal and job information
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="firstName">First Name *</Label>
                        <Input
                          id="firstName"
                          value={employeeForm.firstName}
                          onChange={(e) => setEmployeeForm(prev => ({ ...prev, firstName: e.target.value }))}
                          placeholder="John"
                          data-testid="input-first-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastName">Last Name *</Label>
                        <Input
                          id="lastName"
                          value={employeeForm.lastName}
                          onChange={(e) => setEmployeeForm(prev => ({ ...prev, lastName: e.target.value }))}
                          placeholder="Doe"
                          data-testid="input-last-name"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="email">Email *</Label>
                        <Input
                          id="email"
                          type="email"
                          value={employeeForm.email}
                          onChange={(e) => setEmployeeForm(prev => ({ ...prev, email: e.target.value }))}
                          placeholder="john.doe@company.com"
                          data-testid="input-email"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone</Label>
                        <Input
                          id="phone"
                          value={employeeForm.phone}
                          onChange={(e) => setEmployeeForm(prev => ({ ...prev, phone: e.target.value }))}
                          placeholder="(555) 123-4567"
                          data-testid="input-phone"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="department">Department *</Label>
                        <Select 
                          value={employeeForm.department} 
                          onValueChange={(value) => setEmployeeForm(prev => ({ ...prev, department: value }))}
                          data-testid="select-department"
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select department" />
                          </SelectTrigger>
                          <SelectContent>
                            {departments.map(dept => (
                              <SelectItem key={dept} value={dept} data-testid={`option-${dept.toLowerCase().replace(/\s+/g, '-')}`}>
                                {dept}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="position">Position *</Label>
                        <Input
                          id="position"
                          value={employeeForm.position}
                          onChange={(e) => setEmployeeForm(prev => ({ ...prev, position: e.target.value }))}
                          placeholder="e.g., Sales Representative"
                          data-testid="input-position"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="startDate">Start Date *</Label>
                        <Input
                          id="startDate"
                          type="date"
                          value={employeeForm.startDate}
                          onChange={(e) => setEmployeeForm(prev => ({ ...prev, startDate: e.target.value }))}
                          data-testid="input-start-date"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="manager">Manager *</Label>
                        <Select 
                          value={employeeForm.manager} 
                          onValueChange={(value) => setEmployeeForm(prev => ({ ...prev, manager: value }))}
                          data-testid="select-manager"
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select manager" />
                          </SelectTrigger>
                          <SelectContent>
                            {managers.map(manager => (
                              <SelectItem key={manager.id} value={manager.id} data-testid={`option-manager-${manager.id}`}>
                                {manager.name} ({manager.department})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="employeeId">Employee ID</Label>
                        <Input
                          id="employeeId"
                          value={employeeForm.employeeId}
                          onChange={(e) => setEmployeeForm(prev => ({ ...prev, employeeId: e.target.value }))}
                          placeholder="EMP-001"
                          data-testid="input-employee-id"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="emergencyContact">Emergency Contact</Label>
                        <Input
                          id="emergencyContact"
                          value={employeeForm.emergencyContact}
                          onChange={(e) => setEmployeeForm(prev => ({ ...prev, emergencyContact: e.target.value }))}
                          placeholder="Jane Doe"
                          data-testid="input-emergency-contact"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="emergencyPhone">Emergency Phone</Label>
                        <Input
                          id="emergencyPhone"
                          value={employeeForm.emergencyPhone}
                          onChange={(e) => setEmployeeForm(prev => ({ ...prev, emergencyPhone: e.target.value }))}
                          placeholder="(555) 987-6543"
                          data-testid="input-emergency-phone"
                        />
                      </div>
                    </div>

                    <Button type="submit" className="w-full" data-testid="button-submit-employee">
                      Create Employee Profile
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>

            {/* Onboarding Checklist */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2" data-testid="text-checklist-title">
                    <CheckCircle className="h-5 w-5" />
                    Onboarding Checklist
                  </CardTitle>
                  <CardDescription>
                    Track completion of onboarding tasks
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-4">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span>Progress</span>
                      <span data-testid="text-progress">{completedTasks}/{totalTasks}</span>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div 
                        className="bg-primary h-2 rounded-full transition-all duration-300"
                        style={{ width: `${(completedTasks / totalTasks) * 100}%` }}
                        data-testid="progress-bar"
                      ></div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {onboardingTasks.map((task) => (
                      <div key={task.id} className="flex items-center space-x-3">
                        <Checkbox 
                          id={task.id}
                          checked={task.completed}
                          onCheckedChange={() => toggleTask(task.id)}
                          data-testid={`checkbox-${task.id}`}
                        />
                        <Label 
                          htmlFor={task.id} 
                          className={`flex-1 ${task.completed ? 'line-through text-muted-foreground' : ''}`}
                          data-testid={`label-${task.id}`}
                        >
                          {task.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2" data-testid="text-timeline-title">
                    <Clock className="h-5 w-5" />
                    Onboarding Timeline
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-primary rounded-full"></div>
                    <span><strong>Day 1:</strong> Welcome & Orientation</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-muted rounded-full"></div>
                    <span><strong>Day 3:</strong> System Training</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-muted rounded-full"></div>
                    <span><strong>Week 1:</strong> Department Introduction</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-muted rounded-full"></div>
                    <span><strong>Week 2:</strong> Role-specific Training</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-muted rounded-full"></div>
                    <span><strong>Month 1:</strong> Performance Review</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}