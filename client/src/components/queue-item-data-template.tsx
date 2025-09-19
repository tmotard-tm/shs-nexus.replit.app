import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { 
  User, 
  Briefcase, 
  Car, 
  Clock, 
  MapPin, 
  Settings, 
  Calendar, 
  Phone, 
  Mail,
  Building,
  Hash,
  Tag,
  FileText
} from "lucide-react";

interface QueueItemDataTemplateProps {
  data: string | null;
}

interface ParsedData {
  [key: string]: any;
}

// Helper function to format field names to readable labels
const formatFieldLabel = (fieldName: string): string => {
  return fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
};

// Helper function to get appropriate icon for different field types
const getFieldIcon = (fieldName: string, value: any) => {
  const lowerFieldName = fieldName.toLowerCase();
  
  if (lowerFieldName.includes('employee') || lowerFieldName.includes('user') || lowerFieldName.includes('submitter')) {
    return <User className="h-4 w-4" />;
  }
  if (lowerFieldName.includes('vehicle') || lowerFieldName.includes('car') || lowerFieldName.includes('truck')) {
    return <Car className="h-4 w-4" />;
  }
  if (lowerFieldName.includes('workflow') || lowerFieldName.includes('step')) {
    return <Settings className="h-4 w-4" />;
  }
  if (lowerFieldName.includes('date') || lowerFieldName.includes('time')) {
    return <Calendar className="h-4 w-4" />;
  }
  if (lowerFieldName.includes('phone')) {
    return <Phone className="h-4 w-4" />;
  }
  if (lowerFieldName.includes('email')) {
    return <Mail className="h-4 w-4" />;
  }
  if (lowerFieldName.includes('location') || lowerFieldName.includes('address') || lowerFieldName.includes('district')) {
    return <MapPin className="h-4 w-4" />;
  }
  if (lowerFieldName.includes('department') || lowerFieldName.includes('company')) {
    return <Building className="h-4 w-4" />;
  }
  if (lowerFieldName.includes('id') && typeof value === 'string') {
    return <Hash className="h-4 w-4" />;
  }
  if (lowerFieldName.includes('type') || lowerFieldName.includes('phase')) {
    return <Tag className="h-4 w-4" />;
  }
  if (lowerFieldName.includes('reason') || lowerFieldName.includes('description') || lowerFieldName.includes('notes')) {
    return <FileText className="h-4 w-4" />;
  }
  
  return <FileText className="h-4 w-4" />;
};

// Helper function to format values based on their type and content
const formatValue = (key: string, value: any): string => {
  if (value === null || value === undefined) {
    return 'N/A';
  }
  
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  
  if (typeof value === 'number') {
    return value.toString();
  }
  
  if (typeof value === 'string') {
    // Check if it's a date string
    if (key.toLowerCase().includes('date') || key.toLowerCase().includes('time')) {
      const date = new Date(value);
      if (!isNaN(date.getTime()) && value.includes('T')) {
        return date.toLocaleString();
      }
    }
    
    // Format workflow types and other underscore-separated values
    if (value.includes('_')) {
      return value.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
    
    return value;
  }
  
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return 'No items';
    }
    
    // Handle arrays of objects or complex values
    return value.map((item, index) => {
      if (typeof item === 'object' && item !== null) {
        // For objects, create a compact representation
        const entries = Object.entries(item);
        if (entries.length === 1) {
          // Single key-value pair, show inline
          const [k, v] = entries[0];
          return `${formatFieldLabel(k)}: ${formatValue(k, v)}`;
        } else if (entries.length <= 3) {
          // Few properties, show as compact list
          return entries.map(([k, v]) => `${formatFieldLabel(k)}: ${formatValue(k, v)}`).join(', ');
        } else {
          // Many properties, show summary
          return `Object ${index + 1} (${entries.length} properties)`;
        }
      }
      return formatValue(key, item);
    }).join('; ');
  }
  
  return JSON.stringify(value);
};

// Helper function to determine if a field should be highlighted
const isHighPriorityField = (fieldName: string): boolean => {
  const priorityFields = [
    'name', 'employee', 'workflowtype', 'step', 'phase', 'vehiclenumber', 'vehicletype',
    'racfid', 'employeeid', 'reason', 'lastdayworked', 'district', 'serviceorder'
  ];
  return priorityFields.some(field => fieldName.toLowerCase().includes(field));
};

// Recursive component to render nested objects
const DataField: React.FC<{ fieldKey: string; value: any; level?: number }> = ({ fieldKey, value, level = 0 }) => {
  const isNested = typeof value === 'object' && value !== null && !Array.isArray(value);
  const isPriority = isHighPriorityField(fieldKey);
  
  if (isNested) {
    return (
      <div className={`space-y-2 ${level > 0 ? 'ml-4 pl-4 border-l-2 border-muted' : ''}`}>
        <div className="flex items-center gap-2 mb-2">
          {getFieldIcon(fieldKey, value)}
          <h4 className={`font-medium text-sm ${isPriority ? 'text-primary font-semibold' : 'text-foreground'}`}>
            {formatFieldLabel(fieldKey)}
          </h4>
        </div>
        <div className="space-y-2">
          {Object.entries(value).map(([nestedKey, nestedValue]) => (
            <DataField 
              key={nestedKey} 
              fieldKey={nestedKey} 
              value={nestedValue} 
              level={level + 1}
            />
          ))}
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex items-start gap-3 py-1">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {getFieldIcon(fieldKey, value)}
        <div className="min-w-0 flex-1">
          <div className={`text-sm ${isPriority ? 'font-semibold text-primary' : 'font-medium text-muted-foreground'}`}>
            {formatFieldLabel(fieldKey)}
          </div>
          <div className={`text-sm break-words ${isPriority ? 'font-medium text-foreground' : 'text-foreground'}`} data-testid={`data-field-${fieldKey.toLowerCase()}`}>
            {formatValue(fieldKey, value)}
          </div>
        </div>
      </div>
    </div>
  );
};

export function QueueItemDataTemplate({ data }: QueueItemDataTemplateProps) {
  if (!data) {
    return (
      <div className="text-sm text-muted-foreground italic" data-testid="no-additional-data">
        No additional data available
      </div>
    );
  }
  
  let parsedData: ParsedData;
  try {
    parsedData = JSON.parse(data);
  } catch (error) {
    return (
      <div className="text-sm text-red-600" data-testid="invalid-data-error">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="h-4 w-4" />
          <span className="font-medium">Raw Data</span>
        </div>
        <div className="bg-muted p-3 rounded-md font-mono text-xs">
          {data}
        </div>
      </div>
    );
  }
  
  if (!parsedData || typeof parsedData !== 'object') {
    return (
      <div className="text-sm text-muted-foreground italic" data-testid="no-data-to-display">
        No data to display
      </div>
    );
  }
  
  // Group fields by category for better organization
  const workflowFields: [string, any][] = [];
  const employeeFields: [string, any][] = [];
  const vehicleFields: [string, any][] = [];
  const submitterFields: [string, any][] = [];
  const otherFields: [string, any][] = [];
  
  Object.entries(parsedData).forEach(([key, value]) => {
    const lowerKey = key.toLowerCase();
    
    if (lowerKey.includes('workflow') || lowerKey.includes('step') || lowerKey.includes('phase')) {
      workflowFields.push([key, value]);
    } else if (lowerKey.includes('employee') || lowerKey.includes('racf') || key === 'employee') {
      employeeFields.push([key, value]);
    } else if (lowerKey.includes('vehicle') || lowerKey.includes('truck') || lowerKey.includes('car')) {
      vehicleFields.push([key, value]);
    } else if (lowerKey.includes('submitter') || key === 'submitterInfo') {
      submitterFields.push([key, value]);
    } else {
      otherFields.push([key, value]);
    }
  });
  
  const sections = [
    { title: 'Workflow Information', fields: workflowFields, icon: <Settings className="h-4 w-4" /> },
    { title: 'Employee Information', fields: employeeFields, icon: <User className="h-4 w-4" /> },
    { title: 'Vehicle Information', fields: vehicleFields, icon: <Car className="h-4 w-4" /> },
    { title: 'Submitter Information', fields: submitterFields, icon: <Briefcase className="h-4 w-4" /> },
    { title: 'Additional Information', fields: otherFields, icon: <FileText className="h-4 w-4" /> }
  ].filter(section => section.fields.length > 0);
  
  return (
    <div className="space-y-4" data-testid="queue-item-data-template">
      {sections.map((section, sectionIndex) => (
        <Card key={section.title} className="border-l-4 border-l-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-primary">
              {section.icon}
              {section.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-3">
              {section.fields.map(([fieldKey, value]) => (
                <DataField 
                  key={fieldKey} 
                  fieldKey={fieldKey} 
                  value={value}
                />
              ))}
            </div>
          </CardContent>
          {sectionIndex < sections.length - 1 && <Separator className="mt-4" />}
        </Card>
      ))}
    </div>
  );
}