import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { WorkTemplate, workTemplateSchema, TemplateLoadResult, TemplateRegistry, QueueModule } from './schema';

/**
 * Template Loader Service
 * Handles loading, validation, and caching of work module templates
 */
export class TemplateLoader {
  private static instance: TemplateLoader;
  private templateCache = new Map<string, WorkTemplate>();
  private registryCache: TemplateRegistry | null = null;
  private readonly templatesDir: string;

  constructor(templatesDir?: string) {
    this.templatesDir = templatesDir || path.join(__dirname, 'templates');
    
    if (this.isDebugEnabled()) {
      console.log('TemplateLoader initialized:');
      console.log('  - __dirname:', __dirname);
      console.log('  - templatesDir:', this.templatesDir);
      console.log('  - templates directory exists:', fs.existsSync(this.templatesDir));
      
      // Log directory contents for debugging
      if (fs.existsSync(this.templatesDir)) {
        try {
          const contents = fs.readdirSync(this.templatesDir);
          console.log('  - templates directory contents:', contents);
        } catch (error) {
          console.error('  - failed to read templates directory:', error);
        }
      }
    }
  }

  static getInstance(templatesDir?: string): TemplateLoader {
    if (!TemplateLoader.instance) {
      TemplateLoader.instance = new TemplateLoader(templatesDir);
    }
    return TemplateLoader.instance;
  }

  /**
   * Load the template registry that maps workflow types to templates
   */
  private async loadRegistry(): Promise<TemplateRegistry> {
    if (this.registryCache) {
      if (this.isDebugEnabled()) {
        console.log('Using cached template registry with keys:', Object.keys(this.registryCache || {}));
      }
      return this.registryCache;
    }

    try {
      const registryPath = path.join(this.templatesDir, 'template-registry.json');
      if (this.isDebugEnabled()) {
        console.log('Loading template registry from:', registryPath);
        console.log('Registry file exists:', fs.existsSync(registryPath));
      }
      
      const registryData = await fs.promises.readFile(registryPath, 'utf-8');
      if (this.isDebugEnabled()) {
        console.log('Registry file read successfully, size:', registryData.length, 'bytes');
      }
      
      const parsedRegistry = JSON.parse(registryData);
      if (this.isDebugEnabled()) {
        console.log('Registry JSON parsed successfully');
      }
      
      // Handle both { registry: {...} } and direct {...} formats
      this.registryCache = parsedRegistry.registry ?? parsedRegistry;
      if (this.isDebugEnabled()) {
        console.log('Template registry loaded with keys:', Object.keys(this.registryCache || {}));
        console.log('Full registry structure:', JSON.stringify(this.registryCache, null, 2));
      }
      return this.registryCache || {};
    } catch (error) {
      console.error('Failed to load template registry from path:', path.join(this.templatesDir, 'template-registry.json'));
      console.error('Registry loading error details:', error);
      return {};
    }
  }

  /**
   * Load a specific template by ID
   */
  async loadTemplate(templateId: string): Promise<TemplateLoadResult> {
    if (this.isDebugEnabled()) {
      console.log(`\n=== Loading template: ${templateId} ===`);
    }
    
    // Check cache first
    if (this.templateCache.has(templateId)) {
      if (this.isDebugEnabled()) {
        console.log(`Template ${templateId} found in cache`);
      }
      return {
        template: this.templateCache.get(templateId)!,
      };
    }

    try {
      // Determine which department directory to look in
      const department = this.extractDepartmentFromTemplateId(templateId);
      if (this.isDebugEnabled()) {
        console.log(`Extracted department: ${department} from templateId: ${templateId}`);
      }
      
      const departmentDir = path.join(this.templatesDir, department.toLowerCase());
      const templatePath = path.join(departmentDir, `${templateId}.json`);
      if (this.isDebugEnabled()) {
        console.log(`Template path: ${templatePath}`);
        console.log(`Department directory exists: ${fs.existsSync(departmentDir)}`);
        console.log(`Template file exists: ${fs.existsSync(templatePath)}`);
        
        // Log department directory contents if it exists
        if (fs.existsSync(departmentDir)) {
          try {
            const deptContents = fs.readdirSync(departmentDir);
            console.log(`Department ${department.toLowerCase()} directory contents:`, deptContents);
          } catch (error) {
            console.error(`Failed to read department directory ${departmentDir}:`, error);
          }
        }
      }
      
      // Check if file exists
      if (!fs.existsSync(templatePath)) {
        const errorMsg = `Template file not found: ${templateId}`;
        if (this.isDebugEnabled()) {
          console.error(`${errorMsg} at path: ${templatePath}`);
        }
        const suggestions = await this.getSuggestedTemplates(templateId);
        if (this.isDebugEnabled()) {
          console.log(`Suggestions for ${templateId}:`, suggestions);
        }
        return {
          template: null,
          error: errorMsg,
          suggestions
        };
      }

      // Load and parse template
      if (this.isDebugEnabled()) {
        console.log(`Reading template file from: ${templatePath}`);
      }
      const templateData = await fs.promises.readFile(templatePath, 'utf-8');
      if (this.isDebugEnabled()) {
        console.log(`Template file read successfully, size: ${templateData.length} bytes`);
      }
      
      const parsedTemplate = JSON.parse(templateData);
      if (this.isDebugEnabled()) {
        console.log(`Template JSON parsed successfully for: ${templateId}`);
        console.log(`Template structure:`, {
          id: parsedTemplate.id,
          name: parsedTemplate.name,
          department: parsedTemplate.department,
          workflowType: parsedTemplate.workflowType,
          version: parsedTemplate.version,
          stepsCount: parsedTemplate.steps?.length || 0
        });
      }

      // Validate template structure
      const validationResult = workTemplateSchema.safeParse(parsedTemplate);
      if (!validationResult.success) {
        console.error(`Template validation failed for ${templateId}:`, validationResult.error.errors);
        return {
          template: null,
          error: `Template validation failed: ${validationResult.error.message}`,
          suggestions: await this.getSuggestedTemplates(templateId)
        };
      }

      // Cache and return
      const template = validationResult.data;
      this.templateCache.set(templateId, template);
      if (this.isDebugEnabled()) {
        console.log(`Template ${templateId} loaded and cached successfully`);
      }
      
      return { template };
    } catch (error) {
      console.error(`Error loading template ${templateId}:`, error);
      return {
        template: null,
        error: `Failed to load template: ${error instanceof Error ? error.message : 'Unknown error'}`,
        suggestions: await this.getSuggestedTemplates(templateId)
      };
    }
  }

  /**
   * Get template for a specific workflow type and department
   */
  async getTemplateForWorkflow(workflowType: string, department: QueueModule): Promise<TemplateLoadResult> {
    try {
      const registry = await this.loadRegistry();
      const departmentTemplates = registry[workflowType]?.[department.toUpperCase()];
      
      if (!departmentTemplates || departmentTemplates.length === 0) {
        // Attempt fallback strategies
        const fallbackResult = await this.tryFallbackTemplate(workflowType, department, registry);
        if (fallbackResult) {
          return fallbackResult;
        }
        
        return {
          template: null,
          error: `No template found for workflow ${workflowType} in department ${department}`,
          suggestions: await this.getSuggestedWorkflowTemplates(workflowType)
        };
      }

      // Use the first template for now (can be enhanced to support multiple templates later)
      const templateId = departmentTemplates[0];
      return await this.loadTemplate(templateId);
    } catch (error) {
      return {
        template: null,
        error: `Failed to get template for workflow: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Try fallback strategies for missing templates
   */
  private async tryFallbackTemplate(workflowType: string, department: QueueModule, registry: any): Promise<TemplateLoadResult | null> {
    if (this.isDebugEnabled()) {
      console.log(`Template fallback: Attempting fallbacks for ${workflowType}/${department}`);
    }

    // 1. Try workflow-specific aliases
    const fallbackWorkflows = this.getFallbackWorkflows(workflowType);
    for (const fallbackWorkflow of fallbackWorkflows) {
      const fallbackTemplates = registry[fallbackWorkflow]?.[department.toUpperCase()];
      if (fallbackTemplates && fallbackTemplates.length > 0) {
        if (this.isDebugEnabled()) {
          console.log(`Template fallback: Using ${fallbackWorkflow} template for ${workflowType}/${department}`);
        }
        const result = await this.loadTemplate(fallbackTemplates[0]);
        if (result.template) {
          return {
            template: result.template,
            warning: `Using ${fallbackWorkflow} template as fallback for ${workflowType}`,
            suggestions: await this.getSuggestedWorkflowTemplates(workflowType)
          };
        }
      }
    }

    // 2. Try same workflow in other departments (priority order: ASSETS, INVENTORY, FLEET)
    const fallbackDepartments = (['ASSETS', 'INVENTORY', 'FLEET'] as unknown as QueueModule[]).filter(d => d !== department.toUpperCase());
    for (const fallbackDept of fallbackDepartments) {
      const fallbackTemplates = registry[workflowType]?.[fallbackDept];
      if (fallbackTemplates && fallbackTemplates.length > 0) {
        if (this.isDebugEnabled()) {
          console.log(`Template fallback: Using ${fallbackDept} template for ${workflowType}/${department}`);
        }
        const result = await this.loadTemplate(fallbackTemplates[0]);
        if (result.template) {
          return {
            template: result.template,
            warning: `Using ${fallbackDept} template as fallback for ${department} department`,
            suggestions: await this.getSuggestedWorkflowTemplates(workflowType)
          };
        }
      }
    }

    return null;
  }

  /**
   * Get fallback workflow types for a given workflow
   */
  private getFallbackWorkflows(workflowType: string): string[] {
    const fallbackMap: Record<string, string[]> = {
      'onboarding': ['onboarding_day0', 'onboarding_general'],
      'offboarding': ['offboarding_sequence'],
      'vehicle_assignment': ['van_assignment'],
      'decommission': []
    };
    return fallbackMap[workflowType] || [];
  }

  /**
   * Get template for a specific task with enhanced step-based selection
   * Prioritizes specific templates for Day 0 tasks based on step data
   */
  async getTemplateForTask(workflowType: string, department: QueueModule, taskData?: any): Promise<TemplateLoadResult> {
    try {
      // Parse task data if it's a string
      let parsedData = taskData;
      if (typeof taskData === 'string') {
        try {
          parsedData = JSON.parse(taskData);
        } catch {
          parsedData = null;
        }
      }

      // Check for specific step mappings for Day 0 tasks
      if (parsedData?.step && parsedData?.phase === 'day0' && parsedData?.isDay0Task) {
        const specificWorkflowType = this.mapStepToWorkflowType(parsedData.step);
        if (specificWorkflowType && specificWorkflowType !== workflowType) {
          if (this.isDebugEnabled()) {
            console.log(`Template selection: Using specific workflow type '${specificWorkflowType}' instead of '${workflowType}' for step '${parsedData.step}'`);
          }
          const specificResult = await this.getTemplateForWorkflow(specificWorkflowType, department);
          if (specificResult.template) {
            return specificResult;
          }
        }
      }

      // Check for other specific step patterns
      if (parsedData?.step) {
        const specificWorkflowType = this.mapStepToWorkflowType(parsedData.step);
        if (specificWorkflowType && specificWorkflowType !== workflowType) {
          if (this.isDebugEnabled()) {
            console.log(`Template selection: Using specific workflow type '${specificWorkflowType}' instead of '${workflowType}' for step '${parsedData.step}'`);
          }
          const specificResult = await this.getTemplateForWorkflow(specificWorkflowType, department);
          if (specificResult.template) {
            return specificResult;
          }
        }
      }

      // Fallback to original workflow type
      return await this.getTemplateForWorkflow(workflowType, department);
    } catch (error) {
      return {
        template: null,
        error: `Failed to get template for task: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Map workflow step to specific workflow type for better template selection
   */
  private mapStepToWorkflowType(step: string): string | null {
    // Day 0 specific step mappings
    const stepMappings: Record<string, string> = {
      // NTAO Day 0 steps
      'ntao_stop_replenishment_day0': 'stop_shipment',
      
      // Equipment/Assets Day 0 steps  
      'equipment_recover_devices_day0': 'equipment_recovery',
      
      // Fleet Day 0 steps - keep as offboarding for now
      'fleet_initial_coordination_day0': 'offboarding',
      
      // Inventory Day 0 steps - keep as offboarding for now
      'inventory_remove_tpms_day0': 'offboarding',
      
      // Other specific workflow steps
      'fleet_vehicle_retrieval_phase2': 'offboarding',
      'fleet_shop_coordination_phase2': 'offboarding',
      'assist_parts_count': 'offboarding',
      'vehicle_readiness': 'offboarding',
    };

    return stepMappings[step] || null;
  }

  /**
   * Check if debug logging is enabled
   */
  private isDebugEnabled(): boolean {
    return process.env.DEBUG_TEMPLATES === 'true' || process.env.NODE_ENV === 'development' || true; // Enable temporarily to debug user issue
  }

  /**
   * Get all available templates for a department
   */
  async getTemplatesForDepartment(department: QueueModule): Promise<WorkTemplate[]> {
    try {
      const registry = await this.loadRegistry();
      const templates: WorkTemplate[] = [];
      
      for (const workflowType in registry) {
        const departmentTemplates = registry[workflowType][department.toUpperCase()];
        if (departmentTemplates) {
          for (const templateId of departmentTemplates) {
            const result = await this.loadTemplate(templateId);
            if (result.template) {
              templates.push(result.template);
            }
          }
        }
      }
      
      return templates;
    } catch (error) {
      console.error('Failed to get templates for department:', error);
      return [];
    }
  }

  /**
   * Refresh template cache
   */
  clearCache(): void {
    this.templateCache.clear();
    this.registryCache = null;
  }

  /**
   * Validate all templates in the system
   */
  async validateAllTemplates(): Promise<{ valid: string[], invalid: Array<{ id: string, error: string }> }> {
    const valid: string[] = [];
    const invalid: Array<{ id: string, error: string }> = [];

    try {
      const registry = await this.loadRegistry();
      
      for (const workflowType in registry) {
        for (const department in registry[workflowType]) {
          const templateIds = registry[workflowType][department];
          for (const templateId of templateIds) {
            const result = await this.loadTemplate(templateId);
            if (result.template) {
              valid.push(templateId);
            } else {
              invalid.push({ id: templateId, error: result.error || 'Unknown error' });
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to validate templates:', error);
    }

    return { valid, invalid };
  }

  /**
   * Extract department from template ID (assumes format: department_action_version)
   */
  private extractDepartmentFromTemplateId(templateId: string): string {
    const parts = templateId.split('_');
    if (parts.length >= 2) {
      const department = parts[0].toUpperCase();
      if (['FLEET', 'INVENTORY', 'ASSETS', 'NTAO'].includes(department)) {
        return department;
      }
    }
    return 'FLEET'; // Default fallback
  }

  /**
   * Get suggested templates for a given template ID
   */
  private async getSuggestedTemplates(templateId: string): Promise<string[]> {
    try {
      const department = this.extractDepartmentFromTemplateId(templateId);
      const departmentDir = path.join(this.templatesDir, department.toLowerCase());
      
      if (!fs.existsSync(departmentDir)) {
        return [];
      }

      const files = await fs.promises.readdir(departmentDir);
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace('.json', ''))
        .slice(0, 3); // Return top 3 suggestions
    } catch (error) {
      return [];
    }
  }

  /**
   * Get suggested templates for a workflow type across all departments
   */
  private async getSuggestedWorkflowTemplates(workflowType: string): Promise<string[]> {
    try {
      const registry = await this.loadRegistry();
      const suggestions: string[] = [];
      
      for (const department in registry[workflowType] || {}) {
        const templates = registry[workflowType][department];
        suggestions.push(...templates.slice(0, 2)); // Max 2 per department
      }
      
      return suggestions.slice(0, 5); // Return top 5 suggestions
    } catch (error) {
      return [];
    }
  }
}

// Singleton instance export
export const templateLoader = TemplateLoader.getInstance();

// Helper functions for common use cases
export async function getTemplateForTask(workflowType: string, department: QueueModule, taskData?: any): Promise<WorkTemplate | null> {
  const result = await templateLoader.getTemplateForTask(workflowType, department, taskData);
  return result.template;
}

export async function validateTemplate(templateData: any): Promise<{ isValid: boolean, errors?: string[] }> {
  const result = workTemplateSchema.safeParse(templateData);
  return {
    isValid: result.success,
    errors: result.success ? undefined : result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
}