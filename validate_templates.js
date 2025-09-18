import fs from 'fs';
import path from 'path';

// Analyze what templates are missing
const departments = ['ntao', 'assets', 'inventory', 'fleet'];
const workflowTypes = [
  'vehicle_assignment', 'onboarding', 'offboarding', 'decommission', 
  'byov_assignment', 'byov_onboarding', 'onboarding_day0', 'onboarding_day1_5',
  'onboarding_general', 'van_assignment', 'van_unassignment', 'system_updates',
  'stop_shipment', 'setup_shipment', 'equipment_recovery', 'storage_request',
  'create_vehicle', 'offboarding_sequence'
];

// Load registry
const registryPath = './shared/templates/template-registry.json';
const registryData = fs.readFileSync(registryPath, 'utf-8');
const parsedRegistry = JSON.parse(registryData);
const registry = parsedRegistry.registry ?? parsedRegistry;

console.log('=== TEMPLATE VALIDATION ANALYSIS ===\n');

let totalCombinations = 0;
let workingCombinations = 0;
let missingTemplates = 0;
let missingRegistry = 0;
let bothMissing = 0;

const missingList = [];

for (const department of departments) {
  console.log(`\n${department.toUpperCase()} Department:`);
  let deptWorking = 0;
  let deptMissing = 0;
  
  for (const workflowType of workflowTypes) {
    totalCombinations++;
    
    const registryEntry = registry[workflowType]?.[department.toUpperCase()];
    const hasRegistry = !!(registryEntry && registryEntry.length > 0);
    
    let hasTemplate = false;
    let templateId = '';
    if (hasRegistry && registryEntry.length > 0) {
      templateId = registryEntry[0];
      const templatePath = `./shared/templates/${department}/${templateId}.json`;
      hasTemplate = fs.existsSync(templatePath);
    } else {
      templateId = `${department}_${workflowType}_v1`;
      const templatePath = `./shared/templates/${department}/${templateId}.json`;
      hasTemplate = fs.existsSync(templatePath);
    }
    
    if (hasRegistry && hasTemplate) {
      console.log(`  ✓ ${workflowType}`);
      workingCombinations++;
      deptWorking++;
    } else {
      let issue = '';
      if (!hasRegistry && !hasTemplate) {
        issue = 'BOTH_MISSING';
        bothMissing++;
      } else if (!hasRegistry) {
        issue = 'MISSING_REGISTRY';
        missingRegistry++;
      } else {
        issue = 'MISSING_TEMPLATE';
        missingTemplates++;
      }
      
      console.log(`  ✗ ${workflowType} (${issue})`);
      deptMissing++;
      
      missingList.push({
        department: department.toUpperCase(),
        workflowType,
        issue,
        expectedTemplateId: templateId,
        registryEntry: registryEntry || []
      });
    }
  }
  
  console.log(`  Summary: ${deptWorking} working, ${deptMissing} missing`);
}

console.log('\n=== OVERALL SUMMARY ===');
console.log(`Total combinations: ${totalCombinations}`);
console.log(`Working: ${workingCombinations}`);
console.log(`Missing templates: ${missingTemplates}`);
console.log(`Missing registry entries: ${missingRegistry}`);
console.log(`Both missing: ${bothMissing}`);
console.log(`\nCoverage: ${Math.round((workingCombinations / totalCombinations) * 100)}%`);

console.log('\n=== MISSING TEMPLATES DETAILS ===');
missingList.forEach(item => {
  console.log(`${item.department}/${item.workflowType}: ${item.issue} -> ${item.expectedTemplateId}`);
});

console.log('\n=== CRITICAL MISSING TEMPLATES ===');
const criticalWorkflows = ['onboarding', 'offboarding', 'onboarding_day0', 'vehicle_assignment'];
const criticalMissing = missingList.filter(item => criticalWorkflows.includes(item.workflowType));
criticalMissing.forEach(item => {
  console.log(`🔴 CRITICAL: ${item.department}/${item.workflowType} -> ${item.expectedTemplateId}`);
});

