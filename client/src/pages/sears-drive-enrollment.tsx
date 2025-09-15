import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { apiRequest } from "@/lib/queryClient";
import { Upload, FileImage, Truck, User, MapPin, Briefcase, Upload as UploadIcon } from "lucide-react";
import { getPrefillParams, commonValidators } from "@/lib/prefill-params";

// Form validation schema
const enrollmentSchema = z.object({
  districtNumber: z.string().min(1, "District number is required"),
  currentTruckNumber: z.string().min(1, "Current truck number is required"),
  techFirstName: z.string().min(1, "Tech first name is required"),
  techLastName: z.string().min(1, "Tech last name is required"),
  ldap: z.string().min(1, "LDAP is required"),
  techEmail: z.string().email("Valid email is required"),
  referredBy: z.string().min(1, "Referred by is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  industry: z.array(z.string()).min(1, "At least one industry must be selected"),
});

type EnrollmentFormData = z.infer<typeof enrollmentSchema>;

const industryOptions = [
  "Cook",
  "Dish", 
  "Microwave",
  "Laundry",
  "Refrigeration",
  "Hvac",
  "Lawn and Garden"
];

const requiredUploads = [
  { id: "vehicleFront", label: "Vehicle Front Side", required: true },
  { id: "vehicleBack", label: "Vehicle Back Side", required: true },
  { id: "vehicleLeft", label: "Vehicle Left Side", required: true },
  { id: "vehicleRight", label: "Vehicle Right Side", required: true },
  { id: "vinNumber", label: "VIN Number", required: true },
  { id: "insuranceCard", label: "Insurance Card", required: true },
  { id: "registration", label: "Registration", required: true },
];

export default function SearsDriveEnrollment() {
  const { toast } = useToast();
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, File>>({});
  const [uploadPreviews, setUploadPreviews] = useState<Record<string, string>>({});

  // Get prefill data from query parameters
  const getFormDefaultValues = (): EnrollmentFormData => {
    const formFields = [
      'districtNumber', 'currentTruckNumber', 'techFirstName', 'techLastName', 
      'ldap', 'techEmail', 'referredBy', 'city', 'state', 'industry'
    ];

    const prefillData = getPrefillParams(formFields);

    const processedData = {
      districtNumber: prefillData.districtNumber ? commonValidators.text(prefillData.districtNumber) : "",
      currentTruckNumber: prefillData.currentTruckNumber ? commonValidators.vehicleNumber(prefillData.currentTruckNumber) : "",
      techFirstName: prefillData.techFirstName ? commonValidators.employeeName(prefillData.techFirstName) : "",
      techLastName: prefillData.techLastName ? commonValidators.employeeName(prefillData.techLastName) : "",
      ldap: prefillData.ldap ? commonValidators.text(prefillData.ldap) : "",
      techEmail: prefillData.techEmail ? commonValidators.email(prefillData.techEmail) : "",
      referredBy: prefillData.referredBy ? commonValidators.employeeName(prefillData.referredBy) : "",
      city: prefillData.city ? commonValidators.text(prefillData.city) : "",
      state: prefillData.state ? commonValidators.text(prefillData.state) : "",
      industry: prefillData.industry ? (() => {
        try {
          const value = prefillData.industry;
          // Handle array string format like "Cook,Dish,Microwave" or JSON array
          if (value.startsWith('[') && value.endsWith(']')) {
            return JSON.parse(value);
          }
          return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
        } catch {
          return [prefillData.industry]; // Fallback to single item array
        }
      })() : []
    };

    return processedData;
  };

  const form = useForm<EnrollmentFormData>({
    resolver: zodResolver(enrollmentSchema),
    defaultValues: getFormDefaultValues(),
  });

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: async (data: EnrollmentFormData) => {
      // Create FormData for file uploads
      const formData = new FormData();
      
      // Add form fields
      Object.entries(data).forEach(([key, value]) => {
        if (key === 'industry' && Array.isArray(value)) {
          // Handle industry array
          formData.append(key, JSON.stringify(value));
        } else {
          formData.append(key, value as string);
        }
      });
      
      // Add uploaded files
      Object.entries(uploadedFiles).forEach(([key, file]) => {
        formData.append(key, file);
      });

      return apiRequest('POST', '/api/sears-drive-enrollment', formData);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Sears Drive Program enrollment submitted successfully!",
      });
      form.reset();
      setUploadedFiles({});
      setUploadPreviews({});
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to submit enrollment form",
        variant: "destructive",
      });
    },
  });

  const handleFileUpload = (uploadId: string, file: File) => {
    if (file) {
      setUploadedFiles(prev => ({ ...prev, [uploadId]: file }));
      
      // Create preview URL for images
      const reader = new FileReader();
      reader.onload = (e) => {
        setUploadPreviews(prev => ({ ...prev, [uploadId]: e.target?.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const onSubmit = (data: EnrollmentFormData) => {
    // Validate all required files are uploaded
    const missingUploads = requiredUploads.filter(upload => !uploadedFiles[upload.id]);
    
    if (missingUploads.length > 0) {
      toast({
        title: "Missing Files",
        description: `Please upload: ${missingUploads.map(u => u.label).join(', ')}`,
        variant: "destructive",
      });
      return;
    }

    submitMutation.mutate(data);
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <Card className="bg-card">
          <CardHeader className="bg-blue-600 text-white">
            <div className="flex items-center justify-between">
              <CardTitle className="text-2xl font-bold flex items-center gap-3">
                <Truck className="h-8 w-8" />
                Sears BYOV Program Enrollment Submission
              </CardTitle>
              <CopyLinkButton
                variant="icon"
                preserveQuery={true}
                preserveHash={true}
                data-testid="button-copy-form-link"
                className="shrink-0 text-white hover:bg-white/20"
              />
            </div>
          </CardHeader>
          <CardContent className="p-8">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                
                {/* Technician Information */}
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Technician Information
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="districtNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>District Number *</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter district number" {...field} data-testid="input-district-number" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="currentTruckNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Current Truck Number *</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter current truck number" {...field} data-testid="input-truck-number" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="techFirstName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tech First Name *</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter first name" {...field} data-testid="input-first-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="techLastName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tech Last Name *</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter last name" {...field} data-testid="input-last-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="ldap"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>LDAP *</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter LDAP" {...field} data-testid="input-ldap" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="techEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tech Email *</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="Enter email address" {...field} data-testid="input-email" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="referredBy"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Referred By *</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter who referred you" {...field} data-testid="input-referred-by" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="industry"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Industry * (Select all that apply)</FormLabel>
                          <div className="grid grid-cols-2 gap-3 mt-2">
                            {industryOptions.map((industry) => (
                              <div key={industry} className="flex items-center space-x-2">
                                <Checkbox
                                  id={`industry-${industry}`}
                                  checked={field.value?.includes(industry) || false}
                                  onCheckedChange={(checked) => {
                                    const currentValue = field.value || [];
                                    if (checked) {
                                      field.onChange([...currentValue, industry]);
                                    } else {
                                      field.onChange(currentValue.filter((item: string) => item !== industry));
                                    }
                                  }}
                                  data-testid={`checkbox-industry-${industry.toLowerCase().replace(/\s+/g, '-')}`}
                                />
                                <label
                                  htmlFor={`industry-${industry}`}
                                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                                >
                                  {industry}
                                </label>
                              </div>
                            ))}
                          </div>
                          {field.value && Array.isArray(field.value) && field.value.length > 0 && (
                            <div className="mt-2 text-sm text-muted-foreground">
                              Selected: {field.value.join(", ")}
                            </div>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Location Information */}
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    Location Information
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City *</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter city" {...field} data-testid="input-city" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="state"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>State *</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter state" {...field} data-testid="input-state" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Required File Uploads */}
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <UploadIcon className="h-5 w-5" />
                    Required Document Uploads
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {requiredUploads.map((upload) => (
                      <div key={upload.id} className="space-y-3">
                        <label className="text-sm font-medium text-foreground">
                          {upload.label} *
                        </label>
                        <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-4 text-center hover:border-muted-foreground/50 transition-colors relative">
                          {uploadPreviews[upload.id] ? (
                            <div className="space-y-2">
                              <img 
                                src={uploadPreviews[upload.id]} 
                                alt={upload.label}
                                className="max-h-32 mx-auto rounded"
                              />
                              <p className="text-sm text-green-600">✓ Uploaded</p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <FileImage className="h-8 w-8 mx-auto text-muted-foreground" />
                              <p className="text-sm text-muted-foreground">
                                Click to upload {upload.label.toLowerCase()}
                              </p>
                            </div>
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleFileUpload(upload.id, file);
                            }}
                            className="absolute inset-0 opacity-0 cursor-pointer z-10"
                            data-testid={`input-file-${upload.id}`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Submit Button */}
                <div className="flex justify-center pt-6">
                  <Button
                    type="submit"
                    size="lg"
                    className="bg-blue-600 hover:bg-blue-700 text-white px-8"
                    disabled={submitMutation.isPending}
                    data-testid="button-submit-enrollment"
                  >
                    {submitMutation.isPending ? (
                      <>
                        <Upload className="h-4 w-4 mr-2 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Start Process
                      </>
                    )}
                  </Button>
                </div>

              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}