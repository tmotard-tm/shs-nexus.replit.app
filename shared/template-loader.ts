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
      return this.registryCache;
    }

    try {
      const registryPath = path.join(this.templatesDir, 'template-registry.json');
      const registryData = await fs.promises.readFile(registryPath, 'utf-8');
      const parsedRegistry = JSON.parse(registryData);
      this.registryCache = parsedRegistry.registry;
      return this.registryCache || {};
    } catch (error) {
      console.error('Failed to load template registry:', error);
      return {};
    }
  }

  /**
   * Load a specific template by ID
   */
  async loadTemplate(templateId: string): Promise<TemplateLoadResult> {
    // Check cache first
    if (this.templateCache.has(templateId)) {
      return {
        template: this.templateCache.get(templateId)!,
      };
    }

    try {
      // Determine which department directory to look in
      const department = this.extractDepartmentFromTemplateId(templateId);
      const templatePath = path.join(this.templatesDir, department.toLowerCase(), `${templateId}.json`);
      
      // Check if file exists
      if (!fs.existsSync(templatePath)) {
        return {
          template: null,
          error: `Template file not found: ${templateId}`,
          suggestions: await this.getSuggestedTemplates(templateId)
        };
      }

      // Load and parse template
      const templateData = await fs.promises.readFile(templatePath, 'utf-8');
      const parsedTemplate = JSON.parse(templateData);

      // Validate template structure
      const validationResult = workTemplateSchema.safeParse(parsedTemplate);
      if (!validationResult.success) {
        return {
          template: null,
          error: `Template validation failed: ${validationResult.error.message}`,
          suggestions: await this.getSuggestedTemplates(templateId)
        };
      }

      // Cache and return
      const template = validationResult.data;
      this.templateCache.set(templateId, template);
      
      return { template };
    } catch (error) {
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
export async function getTemplateForTask(workflowType: string, department: QueueModule): Promise<WorkTemplate | null> {
  const result = await templateLoader.getTemplateForWorkflow(workflowType, department);
  return result.template;
}

export async function validateTemplate(templateData: any): Promise<{ isValid: boolean, errors?: string[] }> {
  const result = workTemplateSchema.safeParse(templateData);
  return {
    isValid: result.success,
    errors: result.success ? undefined : result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
}