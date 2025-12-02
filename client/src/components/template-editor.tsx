import { useState, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  Minus,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Info,
  Link,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Template editor form schema based on workTemplateSchema - enhanced with all fields
const templateEditorSchema = z.object({
  // Basic template info (existing fields)
  id: z.string().min(1, "ID is required"),
  name: z.string().min(1, "Name is required"),
  department: z.enum(["FLEET", "INVENTORY", "ASSETS", "NTAO"]),
  workflowType: z.string().min(1, "Workflow type is required"),
  version: z.string().min(1, "Version is required"),
  isActive: z.boolean().default(true),
  
  // WorkTemplate content fields
  description: z.string().optional(),
  estimatedDuration: z.coerce.number().min(0).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  requiredRole: z.enum(["field", "agent", "superadmin"]).default("field"),
  
  // Steps array - enhanced with all fields from workTemplateSchema
  steps: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1, "Step title is required"),
    description: z.string().optional(),
    required: z.boolean().default(true),
    completed: z.boolean().default(false),
    notes: z.string().optional(),
    estimatedTime: z.coerce.number().min(0).optional(),
    category: z.enum(["verification", "documentation", "system_action", "communication", "inspection", "approval"]).optional(),
    attachmentRequired: z.boolean().default(false),
    attachmentTypes: z.array(z.string()).optional(),
    validationRule: z.string().optional(),
    conditionalLogic: z.object({
      dependsOn: z.string().optional(),
      condition: z.enum(["equals", "not_equals", "contains", "completed"]).optional(),
      value: z.string().optional()
    }).optional(),
    
    // Link for step
    linkText: z.string().optional(),
    linkUrl: z.string().optional(),
    
    // Enhanced substeps with all fields
    substeps: z.array(z.object({
      id: z.string().min(1),
      title: z.string().min(1, "Substep title is required"),
      description: z.string().optional(),
      required: z.boolean().default(true),
      completed: z.boolean().default(false),
      notes: z.string().optional(),
      validationRule: z.string().optional(),
      conditionalLogic: z.object({
        dependsOn: z.string().optional(),
        condition: z.enum(["equals", "not_equals", "contains", "completed"]).optional(),
        value: z.string().optional()
      }).optional(),
      linkText: z.string().optional(),
      linkUrl: z.string().optional(),
    })).optional(),
  })),
  
  // Final disposition
  finalDisposition: z.object({
    required: z.boolean().default(true),
    options: z.array(z.object({
      value: z.string().min(1),
      label: z.string().min(1),
      requiresApproval: z.boolean().default(false),
    })).optional(),
  }).optional(),
  
  // Metadata for data preservation
  metadata: z.object({
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
    createdBy: z.string().optional(),
    tags: z.array(z.string()).optional(),
    isActive: z.boolean().default(true)
  }).optional(),
});

type TemplateEditorFormData = z.infer<typeof templateEditorSchema>;

interface TemplateEditorProps {
  initialData?: any; // Existing template data (JSON format)
  onSave: (data: TemplateEditorFormData) => void;
  onCancel: () => void;
  mode: "create" | "edit";
  isSubmitting?: boolean;
}

// Helper function for deep merging to preserve unknown fields
function deepMerge(target: any, source: any): any {
  if (source === null || source === undefined) return target;
  if (target === null || target === undefined) return source;
  
  if (Array.isArray(source)) {
    return source.map((item, index) => {
      if (target[index] && typeof item === 'object' && !Array.isArray(item)) {
        return deepMerge(target[index], item);
      }
      return item;
    });
  }
  
  if (typeof source === 'object') {
    const result = { ...target };
    for (const key in source) {
      if (typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key]) {
        result[key] = deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
  
  return source;
}

export function TemplateEditor({
  initialData,
  onSave,
  onCancel,
  mode,
  isSubmitting = false,
}: TemplateEditorProps) {
  const [isJsonMode, setIsJsonMode] = useState(false);
  const [jsonContent, setJsonContent] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<any>(null); // Store original content for data preservation

  // Set originalContent when initialData changes
  useEffect(() => {
    if (initialData?.content) {
      let content = initialData.content;
      if (typeof content === "string") {
        try {
          content = JSON.parse(content);
        } catch (error) {
          console.error("Failed to parse initial content:", error);
        }
      }
      setOriginalContent(content);
    }
  }, [initialData]);

  // Parse initial data into form format with data preservation
  const parseTemplateData = (data: any): TemplateEditorFormData => {
    try {
      // If data.content is a string, parse it as JSON
      let content = data?.content;
      if (typeof content === "string") {
        content = JSON.parse(content);
      }

      return {
        // Basic template fields
        id: data?.id || "",
        name: data?.name || "",
        department: data?.department || "ASSETS",
        workflowType: data?.workflowType || "",
        version: data?.version || "",
        isActive: data?.isActive ?? true,
        
        // WorkTemplate content fields
        description: content?.description || "",
        estimatedDuration: content?.estimatedDuration || undefined,
        difficulty: content?.difficulty || "medium",
        requiredRole: content?.requiredRole || "field",
        steps: (content?.steps || []).map((step: any) => ({
          ...step,
          estimatedTime: step.estimatedTime || undefined,
          notes: step.notes || "",
          validationRule: step.validationRule || "",
          conditionalLogic: step.conditionalLogic || undefined,
          substeps: (step.substeps || []).map((substep: any) => ({
            ...substep,
            notes: substep.notes || "",
            validationRule: substep.validationRule || "",
            conditionalLogic: substep.conditionalLogic || undefined,
          })),
        })),
        finalDisposition: content?.finalDisposition || {
          required: true,
          options: [],
        },
        metadata: content?.metadata || undefined,
      };
    } catch (error) {
      console.error("Failed to parse template data:", error);
      setParseError("Failed to parse template data. Using default values.");
      return {
        id: data?.id || "",
        name: data?.name || "",
        department: data?.department || "ASSETS",
        workflowType: data?.workflowType || "",
        version: data?.version || "",
        isActive: data?.isActive ?? true,
        description: "",
        difficulty: "medium",
        requiredRole: "field",
        steps: [],
        finalDisposition: { required: true, options: [] },
        metadata: undefined,
      };
    }
  };

  const form = useForm<TemplateEditorFormData>({
    resolver: zodResolver(templateEditorSchema),
    defaultValues: parseTemplateData(initialData),
  });

  const {
    fields: stepFields,
    append: appendStep,
    remove: removeStep,
  } = useFieldArray({
    control: form.control,
    name: "steps",
  });

  const {
    fields: dispositionFields,
    append: appendDisposition,
    remove: removeDisposition,
  } = useFieldArray({
    control: form.control,
    name: "finalDisposition.options",
  });

  // Convert form data to JSON format for saving with data preservation
  const convertToJsonFormat = (formData: TemplateEditorFormData) => {
    const { id, name, department, workflowType, version, isActive, ...content } = formData;
    
    // Preserve original unknown fields by deep merging
    const preservedContent = originalContent ? deepMerge(originalContent, content) : content;
    
    return {
      id,
      name,
      department,
      workflowType,
      version,
      isActive,
      // Store as object, not double-stringified
      content: preservedContent,
    };
  };

  const handleFormSubmit = (data: TemplateEditorFormData) => {
    if (isJsonMode) {
      // If in JSON mode, try to parse and validate
      try {
        const parsed = JSON.parse(jsonContent);
        const converted = parseTemplateData(parsed);
        onSave(converted);
      } catch (error) {
        setParseError("Invalid JSON format");
        return;
      }
    } else {
      onSave(data);
    }
  };

  const handleJsonModeToggle = () => {
    if (!isJsonMode) {
      // Switching to JSON mode - convert form data to JSON content only
      const formData = form.getValues();
      const { id, name, department, workflowType, version, isActive, ...content } = formData;
      // Show only the content part in JSON mode, properly formatted
      setJsonContent(JSON.stringify(content, null, 2));
    } else {
      // Switching to form mode - try to parse JSON
      try {
        const parsed = JSON.parse(jsonContent);
        const converted = parseTemplateData({ content: parsed });
        form.reset(converted);
        setParseError(null);
      } catch (error) {
        setParseError("Invalid JSON - keeping current form data");
        return;
      }
    }
    setIsJsonMode(!isJsonMode);
  };

  const addStep = () => {
    appendStep({
      id: `step_${Date.now()}`,
      title: "",
      description: "",
      required: true,
      completed: false,
      estimatedTime: undefined,
      category: undefined,
      attachmentRequired: false,
      substeps: [],
    });
  };

  const addSubstep = (stepIndex: number) => {
    const currentSubsteps = form.getValues(`steps.${stepIndex}.substeps`) || [];
    form.setValue(`steps.${stepIndex}.substeps`, [
      ...currentSubsteps,
      {
        id: `substep_${Date.now()}`,
        title: "",
        description: "",
        required: true,
        completed: false,
      },
    ]);
  };

  const removeSubstep = (stepIndex: number, substepIndex: number) => {
    const currentSubsteps = form.getValues(`steps.${stepIndex}.substeps`) || [];
    const newSubsteps = currentSubsteps.filter((_, i) => i !== substepIndex);
    form.setValue(`steps.${stepIndex}.substeps`, newSubsteps);
  };

  const addDispositionOption = () => {
    appendDisposition({
      value: "",
      label: "",
      requiresApproval: false,
    });
  };

  return (
    <div className="space-y-6">
      {parseError && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{parseError}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">
            {mode === "create" ? "Create Template" : "Edit Template"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {isJsonMode 
              ? "Edit the template as raw JSON" 
              : "Use the structured form to create or edit your template"
            }
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleJsonModeToggle}
          data-testid="button-toggle-json-mode"
        >
          {isJsonMode ? "Switch to Form Mode" : "Switch to JSON Mode"}
        </Button>
      </div>

      {isJsonMode ? (
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Template Content (JSON)</label>
            <Textarea
              value={jsonContent}
              onChange={(e) => setJsonContent(e.target.value)}
              placeholder='{"description": "...", "steps": [], ...}'
              className="min-h-[400px] font-mono text-sm"
              data-testid="textarea-json-content"
            />
          </div>
          <div className="flex justify-end space-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              data-testid="button-cancel-json"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => handleFormSubmit({} as TemplateEditorFormData)}
              disabled={isSubmitting}
              data-testid="button-save-json"
            >
              {isSubmitting ? "Saving..." : "Save Template"}
            </Button>
          </div>
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-6">
            <Tabs defaultValue="basic" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="basic">Basic Info</TabsTrigger>
                <TabsTrigger value="steps">Steps</TabsTrigger>
                <TabsTrigger value="disposition">Final Options</TabsTrigger>
                <TabsTrigger value="advanced">Advanced</TabsTrigger>
              </TabsList>

              <TabsContent value="basic" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Basic Information</CardTitle>
                    <CardDescription>
                      Configure the basic template properties
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="id"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Template ID</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="e.g., assets_onboard_technician_v1"
                                data-testid="input-template-id"
                                disabled={mode === "edit"}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Template Name</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="e.g., Assets Onboarding Template"
                                data-testid="input-template-name"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <FormField
                        control={form.control}
                        name="department"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Department</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid="select-department">
                                  <SelectValue placeholder="Select department" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="ASSETS">Assets</SelectItem>
                                <SelectItem value="FLEET">Fleet</SelectItem>
                                <SelectItem value="INVENTORY">Inventory</SelectItem>
                                <SelectItem value="NTAO">NTAO</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="workflowType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Workflow Type</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="e.g., onboarding"
                                data-testid="input-workflow-type"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="version"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Version</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="e.g., 1.0"
                                data-testid="input-version"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description</FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              placeholder="Describe what this template is used for..."
                              data-testid="textarea-description"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-3 gap-4">
                      <FormField
                        control={form.control}
                        name="estimatedDuration"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Estimated Duration (minutes)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                {...field}
                                value={field.value || ""}
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                                placeholder="e.g., 30"
                                data-testid="input-estimated-duration"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="difficulty"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Difficulty</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid="select-difficulty">
                                  <SelectValue placeholder="Select difficulty" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="easy">Easy</SelectItem>
                                <SelectItem value="medium">Medium</SelectItem>
                                <SelectItem value="hard">Hard</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="requiredRole"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Required Role</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid="select-required-role">
                                  <SelectValue placeholder="Select required role" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="field">Field</SelectItem>
                                <SelectItem value="agent">Agent</SelectItem>
                                <SelectItem value="superadmin">Super Admin</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="isActive"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="checkbox-is-active"
                            />
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel>Active Template</FormLabel>
                            <p className="text-sm text-muted-foreground">
                              Active templates can be used for new workflows
                            </p>
                          </div>
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="steps" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      Workflow Steps
                      <Button
                        type="button"
                        onClick={addStep}
                        size="sm"
                        data-testid="button-add-step"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Step
                      </Button>
                    </CardTitle>
                    <CardDescription>
                      Define the steps that users will follow when using this template
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {stepFields.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Info className="h-8 w-8 mx-auto mb-2" />
                        <p>No steps defined yet. Click "Add Step" to get started.</p>
                      </div>
                    ) : (
                      stepFields.map((step, stepIndex) => (
                        <StepEditor
                          key={step.id}
                          stepIndex={stepIndex}
                          form={form}
                          onRemove={() => removeStep(stepIndex)}
                          onAddSubstep={() => addSubstep(stepIndex)}
                          onRemoveSubstep={(substepIndex) => removeSubstep(stepIndex, substepIndex)}
                        />
                      ))
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="disposition" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      Final Disposition Options
                      <Button
                        type="button"
                        onClick={addDispositionOption}
                        size="sm"
                        data-testid="button-add-disposition"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Option
                      </Button>
                    </CardTitle>
                    <CardDescription>
                      Define the completion options available when the workflow is finished
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="finalDisposition.required"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="checkbox-disposition-required"
                            />
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel>Require Final Disposition</FormLabel>
                            <p className="text-sm text-muted-foreground">
                              Users must select a final disposition to complete the workflow
                            </p>
                          </div>
                        </FormItem>
                      )}
                    />

                    {dispositionFields.map((option, optionIndex) => (
                      <Card key={option.id} className="p-4">
                        <div className="flex items-start justify-between mb-4">
                          <h4 className="font-medium">Option {optionIndex + 1}</h4>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeDisposition(optionIndex)}
                            data-testid={`button-remove-disposition-${optionIndex}`}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name={`finalDisposition.options.${optionIndex}.value`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Value</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="e.g., completed"
                                    data-testid={`input-disposition-value-${optionIndex}`}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`finalDisposition.options.${optionIndex}.label`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Label</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="e.g., Successfully Completed"
                                    data-testid={`input-disposition-label-${optionIndex}`}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <FormField
                          control={form.control}
                          name={`finalDisposition.options.${optionIndex}.requiresApproval`}
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-start space-x-3 space-y-0 mt-4">
                              <FormControl>
                                <Checkbox
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  data-testid={`checkbox-disposition-approval-${optionIndex}`}
                                />
                              </FormControl>
                              <div className="space-y-1 leading-none">
                                <FormLabel>Requires Approval</FormLabel>
                                <p className="text-sm text-muted-foreground">
                                  This option requires supervisor approval before completion
                                </p>
                              </div>
                            </FormItem>
                          )}
                        />
                      </Card>
                    ))}

                    {dispositionFields.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        <Info className="h-8 w-8 mx-auto mb-2" />
                        <p>No disposition options defined. Click "Add Option" to create completion choices.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="advanced" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Advanced Settings</CardTitle>
                    <CardDescription>
                      Additional template configuration options
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        Advanced settings like conditional logic, validation rules, and metadata can be configured here in future versions.
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                data-testid="button-cancel-form"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                data-testid="button-save-form"
              >
                {isSubmitting ? "Saving..." : "Save Template"}
              </Button>
            </div>
          </form>
        </Form>
      )}
    </div>
  );
}

// Step Editor Component
interface StepEditorProps {
  stepIndex: number;
  form: any;
  onRemove: () => void;
  onAddSubstep: () => void;
  onRemoveSubstep: (substepIndex: number) => void;
}

function StepEditor({
  stepIndex,
  form,
  onRemove,
  onAddSubstep,
  onRemoveSubstep,
}: StepEditorProps) {
  const [isOpen, setIsOpen] = useState(true);
  const substeps = form.watch(`steps.${stepIndex}.substeps`) || [];

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="flex items-center space-x-2 p-0">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <span className="font-medium">
                  Step {stepIndex + 1}
                  {form.watch(`steps.${stepIndex}.title`) && 
                    `: ${form.watch(`steps.${stepIndex}.title`)}`
                  }
                </span>
              </Button>
            </CollapsibleTrigger>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              data-testid={`button-remove-step-${stepIndex}`}
            >
              <Minus className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name={`steps.${stepIndex}.id`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Step ID</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., verify_equipment"
                        data-testid={`input-step-id-${stepIndex}`}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`steps.${stepIndex}.title`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Step Title</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., Verify Equipment"
                        data-testid={`input-step-title-${stepIndex}`}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name={`steps.${stepIndex}.description`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Describe what needs to be done in this step..."
                      data-testid={`textarea-step-description-${stepIndex}`}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name={`steps.${stepIndex}.estimatedTime`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estimated Time (minutes)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        value={field.value || ""}
                        onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                        placeholder="e.g., 10"
                        data-testid={`input-step-time-${stepIndex}`}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`steps.${stepIndex}.category`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger data-testid={`select-step-category-${stepIndex}`}>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="verification">Verification</SelectItem>
                        <SelectItem value="documentation">Documentation</SelectItem>
                        <SelectItem value="system_action">System Action</SelectItem>
                        <SelectItem value="communication">Communication</SelectItem>
                        <SelectItem value="inspection">Inspection</SelectItem>
                        <SelectItem value="approval">Approval</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex space-x-6">
              <FormField
                control={form.control}
                name={`steps.${stepIndex}.required`}
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid={`checkbox-step-required-${stepIndex}`}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Required</FormLabel>
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`steps.${stepIndex}.attachmentRequired`}
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid={`checkbox-step-attachment-${stepIndex}`}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Attachment Required</FormLabel>
                    </div>
                  </FormItem>
                )}
              />
            </div>

            {/* Step Link Section */}
            <div className="border rounded-lg p-4 bg-muted/30">
              <div className="flex items-center gap-2 mb-3">
                <Link className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Step Link (Optional)</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name={`steps.${stepIndex}.linkText`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Link Text</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="e.g., View Documentation"
                          className="h-8 text-sm"
                          data-testid={`input-step-link-text-${stepIndex}`}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`steps.${stepIndex}.linkUrl`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Link URL</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="https://example.com/docs"
                          className="h-8 text-sm"
                          data-testid={`input-step-link-url-${stepIndex}`}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <h5 className="font-medium">Substeps</h5>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onAddSubstep}
                data-testid={`button-add-substep-${stepIndex}`}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Substep
              </Button>
            </div>

            {substeps.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No substeps defined. Click "Add Substep" to break this step into smaller tasks.
              </p>
            ) : (
              <div className="space-y-3">
                {substeps.map((substep: any, substepIndex: number) => (
                  <Card key={substepIndex} className="p-3 bg-muted/50">
                    <div className="flex items-start justify-between mb-3">
                      <h6 className="font-medium text-sm">Substep {substepIndex + 1}</h6>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onRemoveSubstep(substepIndex)}
                        data-testid={`button-remove-substep-${stepIndex}-${substepIndex}`}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name={`steps.${stepIndex}.substeps.${substepIndex}.id`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Substep ID</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="e.g., check_serial_number"
                                className="h-8 text-sm"
                                data-testid={`input-substep-id-${stepIndex}-${substepIndex}`}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`steps.${stepIndex}.substeps.${substepIndex}.title`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Substep Title</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="e.g., Check Serial Number"
                                className="h-8 text-sm"
                                data-testid={`input-substep-title-${stepIndex}-${substepIndex}`}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name={`steps.${stepIndex}.substeps.${substepIndex}.description`}
                      render={({ field }) => (
                        <FormItem className="mt-3">
                          <FormLabel className="text-xs">Description</FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              placeholder="Describe this substep..."
                              className="min-h-[60px] text-sm"
                              data-testid={`textarea-substep-description-${stepIndex}-${substepIndex}`}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`steps.${stepIndex}.substeps.${substepIndex}.required`}
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 mt-3">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid={`checkbox-substep-required-${stepIndex}-${substepIndex}`}
                            />
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel className="text-xs">Required</FormLabel>
                          </div>
                        </FormItem>
                      )}
                    />
                    {/* Substep Link Section */}
                    <div className="border rounded p-3 mt-3 bg-background/50">
                      <div className="flex items-center gap-2 mb-2">
                        <Link className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground">Link (Optional)</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <FormField
                          control={form.control}
                          name={`steps.${stepIndex}.substeps.${substepIndex}.linkText`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder="Link text"
                                  className="h-7 text-xs"
                                  data-testid={`input-substep-link-text-${stepIndex}-${substepIndex}`}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`steps.${stepIndex}.substeps.${substepIndex}.linkUrl`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder="https://..."
                                  className="h-7 text-xs"
                                  data-testid={`input-substep-link-url-${stepIndex}-${substepIndex}`}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}