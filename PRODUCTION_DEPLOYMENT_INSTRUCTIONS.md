# Template System Production Deployment Instructions

## Overview
This guide provides comprehensive instructions to deploy the template system overhaul from version 1.3.0 (42% coverage) to version 1.4.0 (57% coverage), resolving ALL production failures across ALL departments (FLEET, INVENTORY, ASSETS, NTAO).

**Critical Issue Resolved**: Missing NTAO Day 0 onboarding template and incomplete template coverage across all departments.

---

## 1. Pre-Deployment Verification Checklist

### A. Development Environment Verification
**⚠️ CRITICAL**: Verify these items in development before deployment:

- [ ] **Template Registry Version**: Confirm `shared/templates/template-registry.json` shows version "1.4.0"
- [ ] **NTAO Day 0 Template**: Verify `shared/templates/ntao/ntao_onboarding_day0_v1.json` exists and is valid
- [ ] **All Department Coverage**: Confirm all 4 departments have complete template sets:
  ```bash
  # Check template counts per department
  ls shared/templates/fleet/*.json | wc -l    # Should be 12 files
  ls shared/templates/assets/*.json | wc -l   # Should be 9 files  
  ls shared/templates/inventory/*.json | wc -l # Should be 9 files
  ls shared/templates/ntao/*.json | wc -l     # Should be 10 files
  ```

### B. Template Validation in Development
**Run these validation commands BEFORE deployment**:

1. **Comprehensive Template Validation**:
   ```bash
   curl -X GET "http://localhost:5000/api/admin/validate-templates" \
        -H "Content-Type: application/json"
   ```
   **Expected Result**: All templates should validate successfully with 0 invalid templates.

2. **Template Diagnostics Check**:
   ```bash
   curl -X GET "http://localhost:5000/api/admin/template-diagnostics" \
        -H "Content-Type: application/json"
   ```
   **Expected Result**: `overallStatus: "healthy"`, `criticalIssues: []`, `ntaoOnboardingAvailable: true`

### C. Specific NTAO Day 0 Verification
**Verify the critical missing template**:
- [ ] File exists: `shared/templates/ntao/ntao_onboarding_day0_v1.json`
- [ ] Contains valid JSON structure with required fields
- [ ] Template ID matches filename: `"id": "ntao_onboarding_day0_v1"`
- [ ] Department correctly set: `"department": "NTAO"`
- [ ] Workflow type correct: `"workflowType": "onboarding_day0"`

---

## 2. Critical Files for Production Deployment

### A. Template Registry (HIGHEST PRIORITY)
**File**: `shared/templates/template-registry.json`
- **Purpose**: Maps workflow types to available templates
- **Version**: Must be 1.4.0
- **Coverage**: 57% (up from 42%)
- **Critical Change**: Added `onboarding_day0` entries for all departments

### B. NTAO Templates (CRITICAL - WAS MISSING)
**Directory**: `shared/templates/ntao/`
**Critical Files**:
- `ntao_onboarding_day0_v1.json` ⚠️ **THIS WAS MISSING IN PRODUCTION**
- `ntao_assign_vehicle_v1.json`
- `ntao_byov_inspection_v1.json`
- `ntao_byov_onboarding_v1.json`
- `ntao_decommission_v1.json`
- `ntao_offboard_technician_v1.json`
- `ntao_offboarding_sequence_v1.json`
- `ntao_onboard_technician_v1.json`
- `ntao_setup_shipment_v1.json`
- `ntao_stop_shipment_v1.json`

### C. Assets Templates (UPDATED)
**Directory**: `shared/templates/assets/`
**Updated Files**:
- `assets_onboarding_day0_v1.json` (Enhanced Day 0 workflow)
- `assets_onboarding_day1_5_v1.json` (New multi-day workflow)
- All other existing templates

### D. Fleet Templates (UPDATED)
**Directory**: `shared/templates/fleet/`
**Updated Files**:
- `fleet_onboarding_day0_v1.json` (Enhanced Day 0 workflow)
- All existing templates with improved validation

### E. Inventory Templates (UPDATED)  
**Directory**: `shared/templates/inventory/`
**Updated Files**:
- `inventory_onboarding_day0_v1.json` (Enhanced Day 0 workflow)
- All existing templates

### F. Template System Code (DEPLOYMENT SUPPORT)
**Files**:
- `shared/template-loader.ts` (Enhanced validation and diagnostics)
- `server/routes.ts` (Diagnostic endpoints for monitoring)

---

## 3. Step-by-Step Deployment Instructions

### Phase 1: Pre-Deployment Preparation (5 minutes)

1. **Create Backup of Current Production Templates**:
   ```bash
   # On production server
   cp -r shared/templates shared/templates_backup_$(date +%Y%m%d_%H%M%S)
   ```

2. **Stop Application** (if using process management):
   ```bash
   # Example for PM2
   pm2 stop your-app-name
   
   # Or for systemd
   systemctl stop your-app-name
   ```

### Phase 2: Template Registry Deployment (2 minutes)

3. **Deploy Updated Template Registry**:
   ```bash
   # Copy the new registry file
   cp /path/to/deployment/shared/templates/template-registry.json shared/templates/
   
   # Verify the version
   grep '"version"' shared/templates/template-registry.json
   # Should show: "version": "1.4.0"
   ```

### Phase 3: NTAO Templates Deployment (CRITICAL - 3 minutes)

4. **Deploy All NTAO Templates**:
   ```bash
   # Ensure NTAO directory exists
   mkdir -p shared/templates/ntao
   
   # Copy all NTAO templates
   cp /path/to/deployment/shared/templates/ntao/*.json shared/templates/ntao/
   
   # CRITICAL: Verify NTAO Day 0 template
   ls -la shared/templates/ntao/ntao_onboarding_day0_v1.json
   ```

### Phase 4: All Department Templates Deployment (5 minutes)

5. **Deploy Updated Templates for All Departments**:
   ```bash
   # Deploy Assets templates
   cp /path/to/deployment/shared/templates/assets/*.json shared/templates/assets/
   
   # Deploy Fleet templates  
   cp /path/to/deployment/shared/templates/fleet/*.json shared/templates/fleet/
   
   # Deploy Inventory templates
   cp /path/to/deployment/shared/templates/inventory/*.json shared/templates/inventory/
   ```

### Phase 5: Template Loader Update (2 minutes)

6. **Deploy Enhanced Template Loader**:
   ```bash
   # Copy the enhanced template loader with diagnostics
   cp /path/to/deployment/shared/template-loader.ts shared/
   
   # Copy updated routes with diagnostic endpoints
   cp /path/to/deployment/server/routes.ts server/
   ```

### Phase 6: Application Restart (2 minutes)

7. **Restart Application**:
   ```bash
   # Example for PM2
   pm2 start your-app-name
   
   # Or for systemd
   systemctl start your-app-name
   
   # Verify application is running
   curl -I http://your-production-url/api
   ```

---

## 4. Post-Deployment Verification Steps

### A. Immediate Health Checks (Run within 5 minutes of deployment)

1. **Application Health Check**:
   ```bash
   curl -I http://your-production-url/api
   # Expected: HTTP 200 OK
   ```

2. **Template System Diagnostic** (CRITICAL):
   ```bash
   curl -X GET "http://your-production-url/api/admin/template-diagnostics" \
        -H "Content-Type: application/json"
   ```
   **Expected Results**:
   - `"overallStatus": "healthy"`
   - `"criticalIssues": []`
   - `"ntaoOnboardingAvailable": true`
   - `"templatesDirectory": "/path/to/shared/templates"`
   - `"registryLoaded": true`

3. **Comprehensive Template Validation**:
   ```bash
   curl -X GET "http://your-production-url/api/admin/validate-templates" \
        -H "Content-Type: application/json"
   ```
   **Expected Results**:
   - `"validTemplates"` count should be ≥ 40 templates
   - `"invalidTemplates"` should be empty array `[]`
   - `"missingTemplates"` should be 0
   - `"coverage"` should be ≥ 57%

### B. Department-Specific Validation

4. **NTAO Day 0 Template Verification** (MOST CRITICAL):
   ```bash
   # Test NTAO onboarding_day0 workflow access
   curl -X POST "http://your-production-url/api/work-templates/get-template" \
        -H "Content-Type: application/json" \
        -d '{"workflowType": "onboarding_day0", "department": "NTAO"}'
   ```
   **Expected**: Should return `ntao_onboarding_day0_v1` template successfully.

5. **All Department Coverage Test**:
   ```bash
   # Test each department's Day 0 coverage
   for dept in FLEET INVENTORY ASSETS NTAO; do
     echo "Testing $dept onboarding_day0..."
     curl -X POST "http://your-production-url/api/work-templates/get-template" \
          -H "Content-Type: application/json" \
          -d "{\"workflowType\": \"onboarding_day0\", \"department\": \"$dept\"}"
   done
   ```

### C. End-to-End Functional Testing

6. **Create Test Workflow for Each Department**:
   ```bash
   # Test creating a Day 0 onboarding task for NTAO (previously failing)
   curl -X POST "http://your-production-url/api/ntao-queue" \
        -H "Content-Type: application/json" \
        -d '{
          "title": "Test NTAO Day 0 Onboarding",
          "workflowType": "onboarding_day0",
          "priority": "medium",
          "data": "{\"employee\": {\"name\": \"Test Employee\"}}"
        }'
   ```

7. **Verify Template Loading in UI**:
   - Navigate to each department queue in the UI
   - Create a new Day 0 onboarding task
   - Verify template loads without errors
   - Check that all steps and substeps are visible

---

## 5. Rollback Plan

### A. Immediate Rollback Triggers
**Execute rollback if ANY of these occur**:
- Template diagnostic endpoint returns `"overallStatus": "error"`
- Template validation shows any invalid templates
- Any department queue fails to load templates
- NTAO Day 0 onboarding still fails

### B. Rollback Procedure (Execute in 3 minutes)

1. **Stop Application**:
   ```bash
   pm2 stop your-app-name
   # or systemctl stop your-app-name
   ```

2. **Restore Template Backup**:
   ```bash
   # Find your backup
   ls -la shared/templates_backup_*
   
   # Restore from latest backup
   rm -rf shared/templates
   cp -r shared/templates_backup_YYYYMMDD_HHMMSS shared/templates
   ```

3. **Restore Previous Code** (if template-loader.ts or routes.ts were updated):
   ```bash
   # Use your version control system
   git checkout HEAD~1 shared/template-loader.ts server/routes.ts
   ```

4. **Restart Application**:
   ```bash
   pm2 start your-app-name
   # or systemctl start your-app-name
   ```

5. **Verify Rollback**:
   ```bash
   curl -I http://your-production-url/api
   ```

### C. Rollback Verification
- [ ] Application responds successfully
- [ ] Template diagnostic shows previous version
- [ ] All department queues accessible (even with limited coverage)
- [ ] No breaking errors in application logs

---

## 6. Long-Term Monitoring Recommendations

### A. Automated Monitoring Setup

1. **Template Health Monitoring** (Run every 5 minutes):
   ```bash
   # Add to cron job or monitoring system
   */5 * * * * curl -s "http://your-production-url/api/admin/template-diagnostics" | jq '.summary.overallStatus' | grep -v "healthy" && echo "Template system unhealthy" | mail -s "Template Alert" admin@company.com
   ```

2. **Template Validation Monitoring** (Run daily):
   ```bash
   # Daily comprehensive validation
   0 6 * * * curl -s "http://your-production-url/api/admin/validate-templates" | jq '.summary.invalidTemplates' | [ $(cat) -gt 0 ] && echo "Invalid templates detected" | mail -s "Template Validation Alert" admin@company.com
   ```

### B. Key Metrics to Monitor

3. **Critical Metrics Dashboard**:
   - Template system overall health status
   - Number of valid vs invalid templates
   - Template coverage percentage (should stay ≥ 57%)
   - NTAO-specific template availability
   - Template loading errors per department
   - Queue item creation success rates

### C. Alert Thresholds

4. **Immediate Alerts** (High Priority):
   - Template diagnostic status != "healthy"
   - Any invalid templates detected
   - NTAO Day 0 template unavailable
   - Template coverage drops below 55%

5. **Warning Alerts** (Medium Priority):
   - Template loading time > 500ms
   - More than 3 template cache misses per hour
   - Any department queue showing template errors

### D. Regular Maintenance

6. **Weekly Maintenance Tasks**:
   - [ ] Review template diagnostic logs
   - [ ] Validate all template files are present
   - [ ] Check for any new missing template requirements
   - [ ] Verify backup systems are working

7. **Monthly Maintenance Tasks**:
   - [ ] Comprehensive template validation audit
   - [ ] Review and update template coverage goals
   - [ ] Analyze template usage patterns per department
   - [ ] Plan for any new template requirements

---

## Summary

This deployment resolves the critical production failures by:

1. **Deploying Missing NTAO Day 0 Template**: The root cause of NTAO failures
2. **Updating Template Registry to v1.4.0**: Improved coverage from 42% to 57%
3. **Enhancing All Department Templates**: Better validation and error handling
4. **Adding Diagnostic Capabilities**: Real-time monitoring and troubleshooting
5. **Providing Comprehensive Monitoring**: Long-term system health tracking

**Total Deployment Time**: ~20 minutes
**Rollback Time**: ~3 minutes if needed
**Expected Result**: 100% resolution of template failures across ALL departments

**Critical Success Indicators**:
- ✅ NTAO Day 0 onboarding works in production
- ✅ All departments can create and access templates
- ✅ Template diagnostic endpoint reports "healthy"
- ✅ 57% template coverage maintained
- ✅ Zero template validation errors

**Contact Information**: 
- For deployment issues: [Your DevOps Team]
- For template questions: [Your Development Team]
- For escalation: [Your Technical Lead]

---

**Document Version**: 1.0
**Last Updated**: September 18, 2025
**Review Date**: October 18, 2025