#!/usr/bin/env node

/**
 * Template Validation Script
 * Tests template loading and validation for all updated templates
 */

const fs = require('fs');
const path = require('path');

// Expected template files and their content structure
const TEMPLATES_TO_VALIDATE = [
  {
    file: 'shared/templates/fleet/fleet_byov_onboarding_v1.json',
    expectedId: 'fleet_byov_onboarding_v1',
    expectedDepartment: 'FLEET',
    expectedWorkflowType: 'byov_onboarding',
    minSteps: 2, // Should have at least van_management and system_updates steps
    requiredSteps: ['van_management', 'system_updates', 'communication']
  },
  {
    file: 'shared/templates/ntao/ntao_byov_inspection_v1.json',
    expectedId: 'ntao_byov_inspection_v1', 
    expectedDepartment: 'NTAO',
    expectedWorkflowType: 'byov_assignment',
    minSteps: 2, // Should have operational steps
    requiredSteps: ['stop_current_operations', 'vehicle_assessment_new_setup']
  },
  {
    file: 'shared/templates/fleet/fleet_onboarding_day0_v1.json',
    expectedId: 'fleet_onboarding_day0_v1',
    expectedDepartment: 'FLEET',
    expectedWorkflowType: 'onboarding_day0',
    minSteps: 1, // Should have vehicle assignment setup
    requiredSteps: ['vehicle_assignment_setup']
  },
  {
    file: 'shared/templates/assets/assets_onboarding_day0_v1.json',
    expectedId: 'assets_onboarding_day0_v1',
    expectedDepartment: 'ASSETS',
    expectedWorkflowType: 'onboarding_day0',
    minSteps: 1, // Should have equipment steps
    requiredSteps: ['equipment_order_shipment', 'system_updates_communication']
  },
  {
    file: 'shared/templates/inventory/inventory_onboarding_day0_v1.json',
    expectedId: 'inventory_onboarding_day0_v1',
    expectedDepartment: 'INVENTORY', 
    expectedWorkflowType: 'onboarding_day0',
    minSteps: 1, // Should have TPMS and inventory steps
    requiredSteps: ['tpms_setup_shipment_verification', 'inventory_count_scheduling']
  }
];

function validateTemplateStructure(template, expectedConfig) {
  const errors = [];
  
  // Basic structure validation
  if (!template.id) errors.push('Missing template id');
  if (!template.name) errors.push('Missing template name');
  if (!template.department) errors.push('Missing department');
  if (!template.workflowType) errors.push('Missing workflowType');
  if (!template.steps || !Array.isArray(template.steps)) {
    errors.push('Missing or invalid steps array');
  } else {
    // Validate steps structure
    if (template.steps.length < expectedConfig.minSteps) {
      errors.push(`Expected at least ${expectedConfig.minSteps} steps, found ${template.steps.length}`);
    }
    
    // Check required steps
    const stepIds = template.steps.map(step => step.id);
    for (const requiredStep of expectedConfig.requiredSteps) {
      if (!stepIds.includes(requiredStep)) {
        errors.push(`Missing required step: ${requiredStep}`);
      }
    }
    
    // Validate each step structure
    template.steps.forEach((step, index) => {
      if (!step.id) errors.push(`Step ${index} missing id`);
      if (!step.title) errors.push(`Step ${index} missing title`);
      if (!step.substeps || !Array.isArray(step.substeps)) {
        errors.push(`Step ${index} missing or invalid substeps`);
      } else {
        // Validate substeps
        step.substeps.forEach((substep, subIndex) => {
          if (!substep.id) errors.push(`Step ${index} substep ${subIndex} missing id`);
          if (!substep.title) errors.push(`Step ${index} substep ${subIndex} missing title`);
        });
      }
    });
  }
  
  // Validate expected values
  if (template.id !== expectedConfig.expectedId) {
    errors.push(`Expected id '${expectedConfig.expectedId}', got '${template.id}'`);
  }
  if (template.department !== expectedConfig.expectedDepartment) {
    errors.push(`Expected department '${expectedConfig.expectedDepartment}', got '${template.department}'`);
  }
  if (template.workflowType !== expectedConfig.expectedWorkflowType) {
    errors.push(`Expected workflowType '${expectedConfig.expectedWorkflowType}', got '${template.workflowType}'`);
  }
  
  return errors;
}

async function validateAllTemplates() {
  console.log('🔍 Starting template validation...\n');
  
  let totalTemplates = 0;
  let validTemplates = 0;
  
  for (const config of TEMPLATES_TO_VALIDATE) {
    totalTemplates++;
    
    console.log(`📋 Validating: ${config.expectedId}`);
    console.log(`   File: ${config.file}`);
    
    try {
      // Check if file exists
      if (!fs.existsSync(config.file)) {
        console.log(`❌ File not found: ${config.file}`);
        continue;
      }
      
      // Read and parse template
      const templateContent = fs.readFileSync(config.file, 'utf8');
      let template;
      
      try {
        template = JSON.parse(templateContent);
      } catch (parseError) {
        console.log(`❌ JSON parsing error: ${parseError.message}`);
        continue;
      }
      
      // Validate structure
      const errors = validateTemplateStructure(template, config);
      
      if (errors.length === 0) {
        console.log(`✅ Template is valid`);
        console.log(`   - Steps: ${template.steps.length}`);
        console.log(`   - Total substeps: ${template.steps.reduce((total, step) => total + step.substeps.length, 0)}`);
        validTemplates++;
      } else {
        console.log(`❌ Validation errors:`);
        errors.forEach(error => console.log(`     - ${error}`));
      }
      
    } catch (error) {
      console.log(`❌ Unexpected error: ${error.message}`);
    }
    
    console.log(''); // Empty line for readability
  }
  
  // Final results
  console.log('='.repeat(60));
  console.log(`📊 VALIDATION RESULTS`);
  console.log('='.repeat(60));
  console.log(`✅ Valid templates: ${validTemplates}/${totalTemplates} (${Math.round(validTemplates/totalTemplates*100)}%)`);
  
  if (validTemplates === totalTemplates) {
    console.log('🎉 All templates passed validation!');
  } else {
    console.log('⚠️  Some templates failed validation. Check the logs above.');
  }
  
  return validTemplates === totalTemplates;
}

// Test template registry mapping
function validateTemplateRegistry() {
  console.log('\n🗂️  Validating template registry...\n');
  
  try {
    const registryPath = 'shared/templates/template-registry.json';
    if (!fs.existsSync(registryPath)) {
      console.log('❌ Template registry not found');
      return false;
    }
    
    const registryContent = fs.readFileSync(registryPath, 'utf8');
    const registry = JSON.parse(registryContent);
    const actualRegistry = registry.registry || registry;
    
    // Check for required workflow types
    const requiredWorkflowTypes = [
      'byov_onboarding',
      'byov_assignment', 
      'onboarding_day0'
    ];
    
    let allFound = true;
    
    for (const workflowType of requiredWorkflowTypes) {
      if (!actualRegistry[workflowType]) {
        console.log(`❌ Missing workflow type in registry: ${workflowType}`);
        allFound = false;
      } else {
        console.log(`✅ Found workflow type: ${workflowType}`);
        
        // Check departments
        const departments = Object.keys(actualRegistry[workflowType]);
        console.log(`   Departments: ${departments.join(', ')}`);
      }
    }
    
    if (allFound) {
      console.log('\n✅ Template registry validation passed');
    } else {
      console.log('\n❌ Template registry validation failed'); 
    }
    
    return allFound;
  } catch (error) {
    console.log(`❌ Registry validation error: ${error.message}`);
    return false;
  }
}

// Run all validations
async function runAllValidations() {
  console.log('🚀 Starting comprehensive template validation...\n');
  
  const templateValidation = await validateAllTemplates();
  const registryValidation = validateTemplateRegistry();
  
  console.log('\n' + '='.repeat(60));
  console.log('🏁 FINAL VALIDATION RESULTS');
  console.log('='.repeat(60));
  
  if (templateValidation && registryValidation) {
    console.log('🎉 All validations passed! Templates are ready for use.');
    process.exit(0);
  } else {
    console.log('❌ Some validations failed. Please fix the issues above.');
    process.exit(1);
  }
}

runAllValidations().catch(console.error);