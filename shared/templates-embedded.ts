// Auto-generated embedded templates for production deployment
// This file contains all template JSON data as TypeScript constants
// Generated from 40 template files

import type { InsertTemplateWithId } from './schema';

// Registry data
export const EMBEDDED_REGISTRY = 
{
  "registry": {
    "vehicle_assignment": {
      "FLEET": [
        "fleet_assign_vehicle_v1"
      ],
      "INVENTORY": [
        "inventory_assign_vehicle_v1"
      ],
      "ASSETS": [
        "assets_assign_vehicle_v1"
      ],
      "NTAO": [
        "ntao_assign_vehicle_v1"
      ]
    },
    "onboarding": {
      "FLEET": [
        "fleet_onboard_technician_v1"
      ],
      "INVENTORY": [
        "inventory_onboard_technician_v1"
      ],
      "ASSETS": [
        "assets_onboard_technician_v1"
      ],
      "NTAO": [
        "ntao_onboard_technician_v1"
      ]
    },
    "offboarding": {
      "FLEET": [
        "fleet_offboard_technician_v1"
      ],
      "INVENTORY": [
        "inventory_offboard_technician_v1"
      ],
      "ASSETS": [
        "assets_offboard_technician_v1"
      ],
      "NTAO": [
        "ntao_offboard_technician_v1"
      ]
    },
    "decommission": {
      "FLEET": [
        "fleet_decommission_vehicle_v1"
      ],
      "INVENTORY": [
        "inventory_process_decommission_v1"
      ],
      "ASSETS": [
        "assets_decommission_v1"
      ],
      "NTAO": [
        "ntao_decommission_v1"
      ]
    },
    "byov_assignment": {
      "FLEET": [
        "fleet_byov_assignment_v1"
      ],
      "INVENTORY": [
        "inventory_byov_inspection_v1"
      ],
      "ASSETS": [
        "assets_byov_inspection_v1"
      ],
      "NTAO": [
        "ntao_byov_inspection_v1"
      ]
    },
    "byov_onboarding": {
      "FLEET": [
        "fleet_byov_onboarding_v1"
      ],
      "INVENTORY": [
        "inventory_byov_onboarding_v1"
      ],
      "ASSETS": [
        "assets_byov_onboarding_v1"
      ],
      "NTAO": [
        "ntao_byov_onboarding_v1"
      ]
    },
    "onboarding_day0": {
      "FLEET": [
        "fleet_onboarding_day0_v1"
      ],
      "INVENTORY": [
        "inventory_onboarding_day0_v1"
      ],
      "ASSETS": [
        "assets_onboarding_day0_v1"
      ],
      "NTAO": [
        "ntao_onboarding_day0_v1"
      ]
    },
    "onboarding_day1_5": {
      "FLEET": [],
      "INVENTORY": [],
      "ASSETS": [
        "assets_onboarding_day1_5_v1"
      ],
      "NTAO": []
    },
    "onboarding_general": {
      "FLEET": [],
      "INVENTORY": [
        "inventory_onboarding_v1"
      ],
      "ASSETS": [],
      "NTAO": []
    },
    "van_assignment": {
      "FLEET": [
        "fleet_assign_van_v1"
      ],
      "INVENTORY": [],
      "ASSETS": [],
      "NTAO": []
    },
    "van_unassignment": {
      "FLEET": [
        "fleet_unassign_van_v1"
      ],
      "INVENTORY": [],
      "ASSETS": [],
      "NTAO": []
    },
    "system_updates": {
      "FLEET": [
        "fleet_update_systems_v1"
      ],
      "INVENTORY": [],
      "ASSETS": [],
      "NTAO": []
    },
    "stop_shipment": {
      "FLEET": [],
      "INVENTORY": [],
      "ASSETS": [],
      "NTAO": [
        "ntao_stop_shipment_v1"
      ]
    },
    "setup_shipment": {
      "FLEET": [],
      "INVENTORY": [],
      "ASSETS": [],
      "NTAO": [
        "ntao_setup_shipment_v1"
      ]
    },
    "equipment_recovery": {
      "FLEET": [],
      "INVENTORY": [],
      "ASSETS": [
        "assets_offboard_technician_v1"
      ],
      "NTAO": []
    },
    "storage_request": {
      "FLEET": [],
      "INVENTORY": [],
      "ASSETS": [],
      "NTAO": []
    },
    "create_vehicle": {
      "FLEET": [
        "fleet_create_vehicle_v1"
      ],
      "INVENTORY": [],
      "ASSETS": [],
      "NTAO": []
    },
    "offboarding_sequence": {
      "FLEET": [
        "fleet_offboarding_sequence_v1"
      ],
      "INVENTORY": [
        "inventory_offboarding_sequence_v1"
      ],
      "ASSETS": [
        "assets_offboarding_sequence_v1"
      ],
      "NTAO": [
        "ntao_offboarding_sequence_v1"
      ]
    }
  },
  "metadata": {
    "version": "1.4.0",
    "lastUpdated": "2025-09-18T18:23:00Z",
    "departments": [
      "FLEET",
      "INVENTORY",
      "ASSETS",
      "NTAO"
    ]
  }
}
;

// Embedded template data for seeding (array format)
const EMBEDDED_TEMPLATES_ARRAY: InsertTemplateWithId[] = [
  {
    "id": "assets_assign_vehicle_v1",
    "department": "ASSETS",
    "workflowType": "vehicle_assignment",
    "version": "1.0",
    "name": "Assets Vehicle Assignment Process",
    "content": "{\"id\":\"assets_assign_vehicle_v1\",\"name\":\"Assets Vehicle Assignment Process\",\"department\":\"ASSETS\",\"workflowType\":\"vehicle_assignment\",\"version\":\"1.0\",\"description\":\"Vehicle assignment process from assets management perspective\",\"estimatedDuration\":35,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"asset_verification\",\"title\":\"Asset Verification and Compliance\",\"description\":\"Verify asset compliance and assignment eligibility\",\"required\":true,\"estimatedTime\":15,\"category\":\"verification\",\"substeps\":[{\"id\":\"check_asset_status\",\"title\":\"Check asset status\",\"description\":\"Verify vehicle is properly registered as company asset\",\"required\":true},{\"id\":\"verify_compliance\",\"title\":\"Verify regulatory compliance\",\"description\":\"Ensure vehicle meets all regulatory requirements\",\"required\":true},{\"id\":\"check_insurance\",\"title\":\"Verify insurance coverage\",\"description\":\"Confirm adequate insurance coverage for assignment\",\"required\":true}]},{\"id\":\"assignment_processing\",\"title\":\"Process Asset Assignment\",\"description\":\"Complete asset assignment documentation\",\"required\":true,\"estimatedTime\":15,\"category\":\"documentation\",\"substeps\":[{\"id\":\"update_asset_register\",\"title\":\"Update asset register\",\"description\":\"Record assignment in asset management system\",\"required\":true},{\"id\":\"generate_assignment_docs\",\"title\":\"Generate assignment documentation\",\"description\":\"Create formal assignment paperwork\",\"required\":true}]},{\"id\":\"stakeholder_notification\",\"title\":\"Notify Stakeholders\",\"description\":\"Send notifications to relevant parties\",\"required\":true,\"estimatedTime\":5,\"category\":\"communication\",\"substeps\":[{\"id\":\"notify_technician\",\"title\":\"Notify technician\",\"description\":\"Send assignment confirmation to technician\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"assigned\",\"label\":\"Asset Successfully Assigned\",\"requiresApproval\":false},{\"value\":\"requires_approval\",\"label\":\"Requires Management Approval\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-01-11T23:45:00Z\",\"createdBy\":\"system\",\"tags\":[\"vehicle\",\"assignment\",\"assets\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "assets_byov_inspection_v1",
    "department": "ASSETS",
    "workflowType": "byov_assignment",
    "version": "1.0",
    "name": "BYOV Vehicle Inspection",
    "content": "{\"id\":\"assets_byov_inspection_v1\",\"name\":\"BYOV Vehicle Inspection\",\"department\":\"ASSETS\",\"workflowType\":\"byov_assignment\",\"version\":\"1.0\",\"description\":\"Comprehensive inspection process for Bring Your Own Vehicle (BYOV) program\",\"estimatedDuration\":90,\"difficulty\":\"hard\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"exterior_inspection\",\"title\":\"Exterior Vehicle Inspection\",\"description\":\"Comprehensive examination of vehicle exterior condition\",\"required\":true,\"estimatedTime\":25,\"category\":\"inspection\",\"attachmentRequired\":true,\"attachmentTypes\":[\"image\"],\"substeps\":[{\"id\":\"body_condition\",\"title\":\"Assess body condition\",\"description\":\"Check for dents, scratches, rust, or other damage\",\"required\":true},{\"id\":\"paint_condition\",\"title\":\"Evaluate paint condition\",\"description\":\"Look for fading, chipping, or touch-up work\",\"required\":true},{\"id\":\"lights_inspection\",\"title\":\"Test all lights and signals\",\"description\":\"Verify headlights, taillights, turn signals, and hazards work\",\"required\":true},{\"id\":\"tire_inspection\",\"title\":\"Inspect tires and wheels\",\"description\":\"Check tread depth, wear patterns, and overall condition\",\"required\":true},{\"id\":\"glass_inspection\",\"title\":\"Examine windows and windshield\",\"description\":\"Check for cracks, chips, or visibility issues\",\"required\":true}]},{\"id\":\"interior_inspection\",\"title\":\"Interior Vehicle Inspection\",\"description\":\"Assess interior condition and functionality\",\"required\":true,\"estimatedTime\":20,\"category\":\"inspection\",\"attachmentRequired\":true,\"attachmentTypes\":[\"image\"],\"substeps\":[{\"id\":\"seat_condition\",\"title\":\"Check seat condition and functionality\",\"description\":\"Test seat adjustments and look for wear or damage\",\"required\":true},{\"id\":\"electronics_test\",\"title\":\"Test electronic systems\",\"description\":\"Verify radio, AC/heat, power windows, and other electronics\",\"required\":true},{\"id\":\"storage_space\",\"title\":\"Assess cargo/storage space\",\"description\":\"Evaluate available space for work equipment and tools\",\"required\":true},{\"id\":\"cleanliness_standards\",\"title\":\"Verify cleanliness standards\",\"description\":\"Ensure vehicle meets company cleanliness requirements\",\"required\":true}]},{\"id\":\"mechanical_inspection\",\"title\":\"Mechanical Systems Inspection\",\"description\":\"Check mechanical systems and safety features\",\"required\":true,\"estimatedTime\":30,\"category\":\"inspection\",\"substeps\":[{\"id\":\"engine_inspection\",\"title\":\"Inspect engine condition\",\"description\":\"Check engine bay for leaks, unusual noises, or issues\",\"required\":true},{\"id\":\"brake_system\",\"title\":\"Test brake system functionality\",\"description\":\"Verify brakes respond properly and check brake fluid\",\"required\":true},{\"id\":\"fluid_levels\",\"title\":\"Check all fluid levels\",\"description\":\"Verify oil, coolant, windshield washer, and other fluids\",\"required\":true},{\"id\":\"exhaust_system\",\"title\":\"Inspect exhaust system\",\"description\":\"Check for leaks, unusual noises, or emission issues\",\"required\":true},{\"id\":\"safety_equipment\",\"title\":\"Verify safety equipment\",\"description\":\"Confirm presence of spare tire, jack, emergency kit\",\"required\":true}]},{\"id\":\"documentation_review\",\"title\":\"Review Vehicle Documentation\",\"description\":\"Verify all required documentation is current and valid\",\"required\":true,\"estimatedTime\":15,\"category\":\"verification\",\"substeps\":[{\"id\":\"registration_check\",\"title\":\"Verify current registration\",\"description\":\"Check registration is current and matches vehicle\",\"required\":true},{\"id\":\"insurance_verification\",\"title\":\"Confirm adequate insurance coverage\",\"description\":\"Verify insurance meets company minimum requirements\",\"required\":true},{\"id\":\"inspection_certificate\",\"title\":\"Check state inspection certificate\",\"description\":\"Ensure current state inspection is valid\",\"required\":true},{\"id\":\"title_verification\",\"title\":\"Verify clear title ownership\",\"description\":\"Confirm technician owns vehicle free and clear\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"approved\",\"label\":\"Vehicle Approved for BYOV Program\",\"requiresApproval\":false},{\"value\":\"conditional_approval\",\"label\":\"Approved with Conditions\",\"requiresApproval\":true},{\"value\":\"rejected\",\"label\":\"Vehicle Rejected - Does Not Meet Standards\",\"requiresApproval\":false},{\"value\":\"requires_repairs\",\"label\":\"Requires Repairs Before Approval\",\"requiresApproval\":false}]},\"metadata\":{\"createdAt\":\"2025-01-11T23:20:00Z\",\"createdBy\":\"system\",\"tags\":[\"byov\",\"inspection\",\"assets\",\"vehicle\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "assets_byov_onboarding_v1",
    "department": "ASSETS",
    "workflowType": "byov_onboarding",
    "version": "1.0",
    "name": "Assets BYOV Technician Onboarding",
    "content": "{\"id\":\"assets_byov_onboarding_v1\",\"name\":\"Assets BYOV Technician Onboarding\",\"department\":\"ASSETS\",\"workflowType\":\"byov_onboarding\",\"version\":\"1.0\",\"description\":\"Assets management onboarding process for Bring Your Own Vehicle technicians\",\"estimatedDuration\":30,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"byov_equipment_allocation\",\"title\":\"BYOV Equipment Allocation\",\"description\":\"Allocate and configure equipment for BYOV operations\",\"required\":true,\"estimatedTime\":20,\"category\":\"system_action\",\"substeps\":[{\"id\":\"determine_portable_equipment_package\",\"title\":\"Determine portable equipment package\",\"description\":\"Select appropriate portable equipment package for BYOV operations\",\"required\":true},{\"id\":\"configure_mobile_equipment_kit\",\"title\":\"Configure mobile equipment kit\",\"description\":\"Prepare mobile equipment kit suitable for personal vehicle transport\",\"required\":true},{\"id\":\"assign_portable_tools\",\"title\":\"Assign portable tools and devices\",\"description\":\"Assign portable tools optimized for BYOV operations\",\"required\":true}]},{\"id\":\"byov_asset_tracking_setup\",\"title\":\"BYOV Asset Tracking Setup\",\"description\":\"Set up asset tracking for BYOV equipment\",\"required\":true,\"estimatedTime\":10,\"category\":\"verification\",\"substeps\":[{\"id\":\"configure_equipment_tracking\",\"title\":\"Configure equipment tracking systems\",\"description\":\"Set up tracking for equipment assigned to BYOV technician\",\"required\":true},{\"id\":\"establish_check_in_protocols\",\"title\":\"Establish equipment check-in protocols\",\"description\":\"Define protocols for regular equipment accountability checks\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"byov_assets_assigned\",\"label\":\"BYOV Assets Assigned Complete\",\"requiresApproval\":false},{\"value\":\"pending_equipment_delivery\",\"label\":\"Pending Equipment Delivery\",\"requiresApproval\":false},{\"value\":\"requires_asset_manager_approval\",\"label\":\"Requires Asset Manager Approval\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-18T00:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"byov\",\"onboarding\",\"assets\",\"portable_equipment\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "assets_decommission_v1",
    "department": "ASSETS",
    "workflowType": "decommission",
    "version": "1.0",
    "name": "Assets Vehicle Decommission Process",
    "content": "{\"id\":\"assets_decommission_v1\",\"name\":\"Assets Vehicle Decommission Process\",\"department\":\"ASSETS\",\"workflowType\":\"decommission\",\"version\":\"1.0\",\"description\":\"Assets management process for vehicle decommissioning and equipment recovery\",\"estimatedDuration\":40,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"equipment_inventory_removal\",\"title\":\"Equipment Inventory and Removal\",\"description\":\"Inventory and remove all company equipment from vehicle\",\"required\":true,\"estimatedTime\":25,\"category\":\"verification\",\"substeps\":[{\"id\":\"inventory_vehicle_equipment\",\"title\":\"Inventory all vehicle equipment\",\"description\":\"Complete inventory of all company equipment installed in vehicle\",\"required\":true},{\"id\":\"remove_company_equipment\",\"title\":\"Remove all company equipment\",\"description\":\"Safely remove all company-owned equipment from vehicle\",\"required\":true},{\"id\":\"document_equipment_condition\",\"title\":\"Document equipment condition\",\"description\":\"Document condition of all removed equipment\",\"required\":true},{\"id\":\"secure_sensitive_equipment\",\"title\":\"Secure sensitive equipment\",\"description\":\"Properly secure and account for any sensitive or high-value equipment\",\"required\":true}]},{\"id\":\"asset_processing\",\"title\":\"Asset Processing and Documentation\",\"description\":\"Process recovered assets and update tracking systems\",\"required\":true,\"estimatedTime\":10,\"category\":\"system_action\",\"substeps\":[{\"id\":\"update_asset_tracking_system\",\"title\":\"Update asset tracking system\",\"description\":\"Update asset tracking with recovered equipment status\",\"required\":true},{\"id\":\"determine_equipment_disposition\",\"title\":\"Determine equipment disposition\",\"description\":\"Determine whether equipment will be redeployed, repaired, or disposed\",\"required\":true}]},{\"id\":\"final_asset_reconciliation\",\"title\":\"Final Asset Reconciliation\",\"description\":\"Complete final reconciliation of all assets\",\"required\":true,\"estimatedTime\":5,\"category\":\"documentation\",\"substeps\":[{\"id\":\"generate_asset_recovery_report\",\"title\":\"Generate asset recovery report\",\"description\":\"Create comprehensive report of all recovered assets\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"assets_recovered_complete\",\"label\":\"All Assets Recovered - Complete\",\"requiresApproval\":false},{\"value\":\"partial_recovery\",\"label\":\"Partial Asset Recovery\",\"requiresApproval\":false},{\"value\":\"requires_investigation\",\"label\":\"Requires Investigation\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-18T00:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"decommission\",\"assets\",\"equipment\",\"recovery\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "assets_offboard_technician_v1",
    "department": "ASSETS",
    "workflowType": "offboarding",
    "version": "1.0",
    "name": "Assets Management Technician Offboarding",
    "content": "{\"id\":\"assets_offboard_technician_v1\",\"name\":\"Assets Management Technician Offboarding\",\"department\":\"ASSETS\",\"workflowType\":\"offboarding\",\"version\":\"1.0\",\"description\":\"Assets management offboarding process for departing technicians\",\"estimatedDuration\":35,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"asset_return_verification\",\"title\":\"Verify Asset Returns\",\"description\":\"Ensure all company assets are properly returned\",\"required\":true,\"estimatedTime\":20,\"category\":\"verification\",\"substeps\":[{\"id\":\"check_asset_register\",\"title\":\"Check asset register\",\"description\":\"Review all assets assigned to departing technician\",\"required\":true},{\"id\":\"physical_asset_inspection\",\"title\":\"Perform physical asset inspection\",\"description\":\"Inspect returned assets for damage or excessive wear\",\"required\":true},{\"id\":\"verify_asset_functionality\",\"title\":\"Verify asset functionality\",\"description\":\"Test that returned assets function as expected\",\"required\":true},{\"id\":\"update_asset_status\",\"title\":\"Update asset management system\",\"description\":\"Mark assets as returned and update their status\",\"required\":true}]},{\"id\":\"compliance_check\",\"title\":\"Compliance and Documentation Check\",\"description\":\"Verify all compliance requirements are met\",\"required\":true,\"estimatedTime\":10,\"category\":\"documentation\",\"substeps\":[{\"id\":\"verify_return_documentation\",\"title\":\"Verify return documentation\",\"description\":\"Ensure all required return paperwork is completed\",\"required\":true},{\"id\":\"check_damage_reports\",\"title\":\"Review any damage reports\",\"description\":\"Document any asset damage for potential charges\",\"required\":true}]},{\"id\":\"final_asset_processing\",\"title\":\"Final Asset Processing\",\"description\":\"Complete final asset-related processing\",\"required\":true,\"estimatedTime\":5,\"category\":\"documentation\",\"substeps\":[{\"id\":\"close_asset_assignments\",\"title\":\"Close all asset assignments\",\"description\":\"Formally close technician's asset assignments\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"completed\",\"label\":\"Assets Offboarding Completed\",\"requiresApproval\":false},{\"value\":\"requires_damage_assessment\",\"label\":\"Requires Damage Assessment\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-01-11T23:50:00Z\",\"createdBy\":\"system\",\"tags\":[\"offboarding\",\"assets\",\"compliance\",\"return\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "assets_offboarding_sequence_v1",
    "department": "ASSETS",
    "workflowType": "offboarding_sequence",
    "version": "1.0",
    "name": "Assets Technician Offboarding Sequence",
    "content": "{\"id\":\"assets_offboarding_sequence_v1\",\"name\":\"Assets Technician Offboarding Sequence\",\"department\":\"ASSETS\",\"workflowType\":\"offboarding_sequence\",\"version\":\"1.0\",\"description\":\"Complete assets recovery and offboarding sequence for departing technicians\",\"estimatedDuration\":45,\"difficulty\":\"high\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"equipment_inventory\",\"title\":\"Complete Equipment Inventory\",\"description\":\"Inventory all assigned equipment and assets\",\"required\":true,\"estimatedTime\":20,\"category\":\"verification\",\"substeps\":[{\"id\":\"inventory_mobile_devices\",\"title\":\"Inventory all mobile devices\",\"description\":\"Account for all company mobile devices, tablets, and communication equipment\",\"required\":true},{\"id\":\"inventory_uniforms_gear\",\"title\":\"Inventory uniforms and safety gear\",\"description\":\"Account for all company uniforms, safety equipment, and branded items\",\"required\":true},{\"id\":\"inventory_tools_equipment\",\"title\":\"Inventory tools and specialized equipment\",\"description\":\"Account for all company tools, diagnostic equipment, and specialized assets\",\"required\":true}]},{\"id\":\"asset_recovery_coordination\",\"title\":\"Asset Recovery Coordination\",\"description\":\"Coordinate return of all company assets\",\"required\":true,\"estimatedTime\":20,\"category\":\"system_action\",\"substeps\":[{\"id\":\"schedule_equipment_return\",\"title\":\"Schedule equipment return\",\"description\":\"Arrange for return of all company equipment and assets\",\"required\":true},{\"id\":\"process_asset_condition_assessment\",\"title\":\"Process asset condition assessment\",\"description\":\"Assess condition of returned assets and document any damage or wear\",\"required\":true},{\"id\":\"update_asset_tracking_system\",\"title\":\"Update asset tracking system\",\"description\":\"Update internal asset tracking with returned items and their status\",\"required\":true}]},{\"id\":\"final_reconciliation\",\"title\":\"Final Asset Reconciliation\",\"description\":\"Complete final reconciliation of all assets\",\"required\":true,\"estimatedTime\":5,\"category\":\"documentation\",\"substeps\":[{\"id\":\"generate_final_asset_report\",\"title\":\"Generate final asset reconciliation report\",\"description\":\"Create comprehensive report of all recovered and outstanding assets\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"assets_recovered_complete\",\"label\":\"All Assets Recovered - Complete\",\"requiresApproval\":false},{\"value\":\"partial_recovery\",\"label\":\"Partial Asset Recovery - Outstanding Items\",\"requiresApproval\":false},{\"value\":\"requires_legal_action\",\"label\":\"Requires Legal Action for Recovery\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-18T00:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"offboarding\",\"sequence\",\"assets\",\"recovery\",\"equipment\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "assets_onboard_technician_v1",
    "department": "ASSETS",
    "workflowType": "onboarding",
    "version": "1.0",
    "name": "Assets Management Technician Onboarding",
    "content": "{\"id\":\"assets_onboard_technician_v1\",\"name\":\"Assets Management Technician Onboarding\",\"department\":\"ASSETS\",\"workflowType\":\"onboarding\",\"version\":\"1.0\",\"description\":\"Assets management onboarding process for new technicians\",\"estimatedDuration\":40,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"day_1_orders\",\"title\":\"Day 1: Essential Orders\",\"description\":\"Order critical items needed immediately for technician\",\"required\":true,\"estimatedTime\":15,\"category\":\"system_action\",\"substeps\":[{\"id\":\"order_phone\",\"title\":\"Order phone\",\"description\":\"Order company phone for technician\",\"required\":true},{\"id\":\"order_uniform\",\"title\":\"Order uniform\",\"description\":\"Order uniform/work apparel for technician\",\"required\":true}]},{\"id\":\"verification_checklist\",\"title\":\"Technician Verification & Assessment\",\"description\":\"Verify technician qualifications and assess needs\",\"required\":true,\"estimatedTime\":20,\"category\":\"verification\",\"substeps\":[{\"id\":\"verify_specialties\",\"title\":\"Verify specialties\",\"description\":\"Confirm technician's specialties and certifications\",\"required\":true},{\"id\":\"verify_tools_needed\",\"title\":\"Verify tools needed\",\"description\":\"Assess what tools are required based on technician role and specialties\",\"required\":true}]},{\"id\":\"parts_shipping\",\"title\":\"Parts & Equipment Shipping\",\"description\":\"Ship necessary parts and equipment to technician\",\"required\":true,\"estimatedTime\":10,\"category\":\"system_action\",\"substeps\":[{\"id\":\"ship_parts\",\"title\":\"Ship parts\",\"description\":\"Ship required parts and equipment to technician location\",\"required\":true}]},{\"id\":\"week_2_tools_order\",\"title\":\"Week 2: Tools Ordering\",\"description\":\"Order specialized tools after initial assessment\",\"required\":true,\"estimatedTime\":15,\"category\":\"system_action\",\"substeps\":[{\"id\":\"tools_will_be_ordered\",\"title\":\"Tools will be ordered\",\"description\":\"Order specialized tools based on verified technician needs\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"completed\",\"label\":\"Assets Onboarding Completed\",\"requiresApproval\":false},{\"value\":\"pending_assets\",\"label\":\"Pending Asset Availability\",\"requiresApproval\":false}]},\"metadata\":{\"createdAt\":\"2025-01-11T23:55:00Z\",\"createdBy\":\"system\",\"tags\":[\"onboarding\",\"assets\",\"compliance\",\"assignment\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "assets_onboarding_day0_v1",
    "department": "ASSETS",
    "workflowType": "onboarding_day0",
    "version": "1.0",
    "name": "Assets Day 0 Technician Onboarding",
    "content": "{\"id\":\"assets_onboarding_day0_v1\",\"name\":\"Assets Day 0 Technician Onboarding\",\"department\":\"ASSETS\",\"workflowType\":\"onboarding_day0\",\"version\":\"1.0\",\"description\":\"Critical Day 0 assets management onboarding tasks\",\"estimatedDuration\":25,\"difficulty\":\"high\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"equipment_order_shipment\",\"title\":\"Order and Ship Critical Equipment\",\"description\":\"Order and ship essential equipment to new hire\",\"required\":true,\"estimatedTime\":15,\"category\":\"system_action\",\"substeps\":[{\"id\":\"order_ship_phone\",\"title\":\"Order and ship phone to new hire\",\"description\":\"Process order and arrange shipping of company mobile phone to new technician's address\",\"required\":true},{\"id\":\"order_ship_uniform\",\"title\":\"Order and ship uniform to new hire\",\"description\":\"Process order and arrange shipping of company uniform to new technician's address\",\"required\":true}]},{\"id\":\"system_updates_communication\",\"title\":\"System Updates and Communication\",\"description\":\"Update systems and communicate with new technician\",\"required\":true,\"estimatedTime\":10,\"category\":\"system_action\",\"substeps\":[{\"id\":\"update_tech_id_phone_tpms\",\"title\":\"Update tech ID and phone number in TPMS\",\"description\":\"Update technician ID and assigned phone number in the TPMS system\",\"required\":true},{\"id\":\"send_welcome_email_tracking\",\"title\":\"Send a welcome email to the technician with all the details including tracking for phone and uniform\",\"description\":\"Send comprehensive welcome email with equipment tracking information, contact details, and next steps\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"day0_assets_ready\",\"label\":\"Day 0 Asset Setup Completed\",\"requiresApproval\":false},{\"value\":\"pending_equipment_delivery\",\"label\":\"Pending Equipment Delivery\",\"requiresApproval\":false},{\"value\":\"requires_approval\",\"label\":\"Requires Additional Approvals\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-17T00:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"onboarding\",\"day0\",\"assets\",\"critical\",\"equipment\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "assets_onboarding_day1_5_v1",
    "department": "ASSETS",
    "workflowType": "onboarding_day1_5",
    "version": "1.0",
    "name": "Assets Day 1-5 Technician Onboarding",
    "content": "{\"id\":\"assets_onboarding_day1_5_v1\",\"name\":\"Assets Day 1-5 Technician Onboarding\",\"department\":\"ASSETS\",\"workflowType\":\"onboarding_day1_5\",\"version\":\"1.0\",\"description\":\"Day 1-5 assets management onboarding and equipment provisioning\",\"estimatedDuration\":60,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"equipment_delivery_tracking\",\"title\":\"Track Equipment Deliveries\",\"description\":\"Monitor and confirm delivery of ordered equipment\",\"required\":true,\"estimatedTime\":15,\"category\":\"verification\",\"substeps\":[{\"id\":\"confirm_phone_delivery\",\"title\":\"Confirm phone delivery\",\"description\":\"Verify company phone has been delivered and activated\",\"required\":true},{\"id\":\"confirm_uniform_delivery\",\"title\":\"Confirm uniform delivery\",\"description\":\"Verify work uniforms have been delivered and fit properly\",\"required\":true},{\"id\":\"confirm_safety_equipment_delivery\",\"title\":\"Confirm safety equipment delivery\",\"description\":\"Verify all safety equipment has been received and inspected\",\"required\":true}]},{\"id\":\"specialized_tools_ordering\",\"title\":\"Order Specialized Tools\",\"description\":\"Process orders for role-specific tools and equipment\",\"required\":true,\"estimatedTime\":25,\"category\":\"system_action\",\"substeps\":[{\"id\":\"finalize_tool_requirements\",\"title\":\"Finalize specialized tool requirements\",\"description\":\"Complete assessment of specialized tools needed based on role\",\"required\":true},{\"id\":\"place_tool_orders\",\"title\":\"Place specialized tool orders\",\"description\":\"Submit orders for all verified specialized tools and equipment\",\"required\":true},{\"id\":\"setup_tool_tracking\",\"title\":\"Setup tool tracking and accountability\",\"description\":\"Register tools in asset management system and establish accountability\",\"required\":true}]},{\"id\":\"parts_inventory_setup\",\"title\":\"Setup Parts and Inventory Access\",\"description\":\"Configure access to parts inventory and shipping systems\",\"required\":true,\"estimatedTime\":15,\"category\":\"system_action\",\"substeps\":[{\"id\":\"setup_parts_shipping\",\"title\":\"Setup initial parts shipment\",\"description\":\"Arrange for initial parts inventory shipment to technician\",\"required\":true},{\"id\":\"configure_inventory_access\",\"title\":\"Configure inventory system access\",\"description\":\"Setup access to parts ordering and inventory management systems\",\"required\":true}]},{\"id\":\"asset_accountability\",\"title\":\"Complete Asset Accountability Setup\",\"description\":\"Finalize asset tracking and accountability processes\",\"required\":true,\"estimatedTime\":5,\"category\":\"documentation\",\"substeps\":[{\"id\":\"complete_asset_inventory\",\"title\":\"Complete initial asset inventory\",\"description\":\"Document all assets assigned to technician in tracking system\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"assets_fully_provisioned\",\"label\":\"All Assets Fully Provisioned\",\"requiresApproval\":false},{\"value\":\"pending_specialized_tools\",\"label\":\"Pending Specialized Tool Delivery\",\"requiresApproval\":false},{\"value\":\"requires_additional_equipment\",\"label\":\"Requires Additional Equipment Authorization\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-17T00:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"onboarding\",\"day1-5\",\"assets\",\"equipment\",\"provisioning\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "fleet_assign_van_v1",
    "department": "FLEET",
    "workflowType": "van_assignment",
    "version": "1.0",
    "name": "BYOV Van Assignment Process",
    "content": "{\"id\":\"fleet_assign_van_v1\",\"name\":\"BYOV Van Assignment Process\",\"department\":\"FLEET\",\"workflowType\":\"van_assignment\",\"version\":\"1.0\",\"description\":\"Complete process for assigning a new BYOV van to a technician\",\"estimatedDuration\":30,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"review_documentation\",\"title\":\"Review Vehicle Documentation\",\"description\":\"Review all submitted vehicle photos and documents\",\"required\":true,\"estimatedTime\":10,\"category\":\"verification\",\"substeps\":[{\"id\":\"check_vehicle_photos\",\"title\":\"Review vehicle photos (front, back, left, right)\",\"description\":\"Inspect all submitted vehicle photos for condition and compliance\",\"required\":true},{\"id\":\"verify_vin\",\"title\":\"Verify VIN number documentation\",\"description\":\"Confirm VIN number is clearly visible and matches records\",\"required\":true},{\"id\":\"check_insurance\",\"title\":\"Review insurance card\",\"description\":\"Verify insurance coverage meets BYOV requirements\",\"required\":true},{\"id\":\"check_registration\",\"title\":\"Review vehicle registration\",\"description\":\"Confirm registration is current and in technician's name\",\"required\":true}]},{\"id\":\"verify_requirements\",\"title\":\"Verify BYOV Requirements\",\"description\":\"Confirm vehicle meets all BYOV program requirements\",\"required\":true,\"estimatedTime\":10,\"category\":\"assessment\",\"substeps\":[{\"id\":\"check_vehicle_size\",\"title\":\"Verify vehicle size requirements\",\"description\":\"Confirm vehicle meets cargo space and size requirements\",\"required\":true},{\"id\":\"assess_condition\",\"title\":\"Assess overall vehicle condition\",\"description\":\"Evaluate if vehicle condition meets company standards\",\"required\":true},{\"id\":\"verify_safety_features\",\"title\":\"Verify required safety features\",\"description\":\"Check for required safety equipment and features\",\"required\":true}]},{\"id\":\"assign_van_number\",\"title\":\"Assign Van Number\",\"description\":\"Assign new BYOV van number and update systems\",\"required\":true,\"estimatedTime\":10,\"category\":\"system_action\",\"substeps\":[{\"id\":\"generate_van_number\",\"title\":\"Generate new van number\",\"description\":\"Create unique van number for BYOV vehicle\",\"required\":true},{\"id\":\"update_fleet_system\",\"title\":\"Update fleet management system\",\"description\":\"Enter new BYOV vehicle into fleet tracking system\",\"required\":true},{\"id\":\"notify_technician\",\"title\":\"Notify technician of van assignment\",\"description\":\"Send van number and next steps to technician\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"van_assigned\",\"label\":\"BYOV Van Successfully Assigned\",\"requiresApproval\":false},{\"value\":\"requirements_not_met\",\"label\":\"Vehicle Does Not Meet Requirements\",\"requiresApproval\":false},{\"value\":\"pending_documentation\",\"label\":\"Pending Additional Documentation\",\"requiresApproval\":false}]},\"metadata\":{\"createdAt\":\"2025-09-12T05:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"byov\",\"van\",\"assignment\",\"fleet\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "fleet_assign_vehicle_v1",
    "department": "FLEET",
    "workflowType": "vehicle_assignment",
    "version": "1.0",
    "name": "Vehicle Assignment Process",
    "content": "{\"id\":\"fleet_assign_vehicle_v1\",\"name\":\"Vehicle Assignment Process\",\"department\":\"FLEET\",\"workflowType\":\"vehicle_assignment\",\"version\":\"1.0\",\"description\":\"Complete process for assigning a vehicle to a technician\",\"estimatedDuration\":45,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"verify_technician\",\"title\":\"Verify Technician Information\",\"description\":\"Confirm technician eligibility and documentation\",\"required\":true,\"estimatedTime\":10,\"category\":\"verification\",\"substeps\":[{\"id\":\"check_enterprise_id\",\"title\":\"Verify Enterprise ID is active\",\"description\":\"Check system to ensure Enterprise ID is valid and active\",\"required\":true},{\"id\":\"verify_license\",\"title\":\"Confirm valid driver's license\",\"description\":\"Review driver's license expiration date and validity\",\"required\":true},{\"id\":\"check_insurance\",\"title\":\"Verify insurance coverage\",\"description\":\"Confirm technician has required insurance coverage\",\"required\":true}]},{\"id\":\"select_vehicle\",\"title\":\"Select Appropriate Vehicle\",\"description\":\"Choose vehicle based on territory and requirements\",\"required\":true,\"estimatedTime\":15,\"category\":\"system_action\",\"substeps\":[{\"id\":\"check_availability\",\"title\":\"Verify vehicle availability\",\"description\":\"Confirm selected vehicle is available for assignment\",\"required\":true},{\"id\":\"match_territory\",\"title\":\"Match vehicle to territory needs\",\"description\":\"Ensure vehicle type matches territory requirements\",\"required\":true},{\"id\":\"check_maintenance\",\"title\":\"Review maintenance status\",\"description\":\"Verify vehicle is in good condition and maintenance is current\",\"required\":true}]},{\"id\":\"create_assignment\",\"title\":\"Create Vehicle Assignment\",\"description\":\"Complete assignment documentation in system\",\"required\":true,\"estimatedTime\":10,\"category\":\"documentation\",\"substeps\":[{\"id\":\"update_vehicle_status\",\"title\":\"Update vehicle status to 'assigned'\",\"description\":\"Change vehicle status in fleet management system\",\"required\":true},{\"id\":\"assign_to_tech\",\"title\":\"Link vehicle to technician profile\",\"description\":\"Create assignment record linking vehicle to technician\",\"required\":true},{\"id\":\"set_assignment_date\",\"title\":\"Set effective assignment date\",\"description\":\"Record when assignment becomes effective\",\"required\":true}]},{\"id\":\"notify_stakeholders\",\"title\":\"Send Notifications\",\"description\":\"Notify relevant parties of vehicle assignment\",\"required\":true,\"estimatedTime\":10,\"category\":\"communication\",\"substeps\":[{\"id\":\"notify_technician\",\"title\":\"Send assignment confirmation to technician\",\"description\":\"Email technician with vehicle details and pickup instructions\",\"required\":true},{\"id\":\"notify_supervisor\",\"title\":\"Inform technician's supervisor\",\"description\":\"Send notification to supervisor about new vehicle assignment\",\"required\":true},{\"id\":\"update_fleet_dashboard\",\"title\":\"Update fleet tracking dashboard\",\"description\":\"Ensure assignment appears on fleet management dashboard\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"assigned\",\"label\":\"Vehicle Successfully Assigned\",\"requiresApproval\":false},{\"value\":\"pending_documentation\",\"label\":\"Pending Additional Documentation\",\"requiresApproval\":false},{\"value\":\"requires_supervisor_approval\",\"label\":\"Requires Supervisor Approval\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-01-11T23:20:00Z\",\"createdBy\":\"system\",\"tags\":[\"vehicle\",\"assignment\",\"fleet\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "fleet_byov_assignment_v1",
    "department": "FLEET",
    "workflowType": "byov_assignment",
    "version": "1.0",
    "name": "Fleet BYOV Assignment Process",
    "content": "{\"id\":\"fleet_byov_assignment_v1\",\"name\":\"Fleet BYOV Assignment Process\",\"department\":\"FLEET\",\"workflowType\":\"byov_assignment\",\"version\":\"1.0\",\"description\":\"Fleet management process for Bring Your Own Vehicle assignments\",\"estimatedDuration\":35,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"vehicle_qualification_verification\",\"title\":\"Vehicle Qualification Verification\",\"description\":\"Verify personal vehicle meets company requirements\",\"required\":true,\"estimatedTime\":20,\"category\":\"verification\",\"substeps\":[{\"id\":\"verify_vehicle_registration\",\"title\":\"Verify vehicle registration and documentation\",\"description\":\"Ensure personal vehicle has valid registration and required documentation\",\"required\":true},{\"id\":\"confirm_insurance_coverage\",\"title\":\"Confirm adequate insurance coverage\",\"description\":\"Verify personal vehicle has adequate insurance coverage for business use\",\"required\":true},{\"id\":\"conduct_vehicle_safety_inspection\",\"title\":\"Conduct vehicle safety inspection\",\"description\":\"Perform safety inspection to ensure vehicle meets operational standards\",\"required\":true},{\"id\":\"verify_vehicle_capacity\",\"title\":\"Verify vehicle storage and transport capacity\",\"description\":\"Ensure vehicle has adequate capacity for equipment and parts transport\",\"required\":true}]},{\"id\":\"byov_setup_coordination\",\"title\":\"BYOV Setup Coordination\",\"description\":\"Coordinate BYOV setup and requirements\",\"required\":true,\"estimatedTime\":10,\"category\":\"coordination\",\"substeps\":[{\"id\":\"coordinate_company_identification\",\"title\":\"Coordinate company identification setup\",\"description\":\"Arrange for appropriate company identification for personal vehicle\",\"required\":true},{\"id\":\"setup_vehicle_tracking_systems\",\"title\":\"Set up vehicle tracking systems\",\"description\":\"Install and configure any required vehicle tracking or communication systems\",\"required\":true}]},{\"id\":\"byov_documentation\",\"title\":\"BYOV Documentation\",\"description\":\"Complete BYOV assignment documentation\",\"required\":true,\"estimatedTime\":5,\"category\":\"documentation\",\"substeps\":[{\"id\":\"complete_byov_agreement\",\"title\":\"Complete BYOV agreement documentation\",\"description\":\"Finalize all required BYOV agreement and liability documentation\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"byov_assignment_approved\",\"label\":\"BYOV Assignment Approved\",\"requiresApproval\":false},{\"value\":\"pending_vehicle_modifications\",\"label\":\"Pending Vehicle Modifications\",\"requiresApproval\":false},{\"value\":\"byov_assignment_denied\",\"label\":\"BYOV Assignment Denied\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-18T00:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"byov\",\"assignment\",\"fleet\",\"personal_vehicle\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "fleet_byov_onboarding_v1",
    "department": "FLEET",
    "workflowType": "byov_onboarding",
    "version": "1.0",
    "name": "Fleet BYOV Technician Onboarding",
    "content": "{\"id\":\"fleet_byov_onboarding_v1\",\"name\":\"Fleet BYOV Technician Onboarding\",\"department\":\"FLEET\",\"workflowType\":\"byov_onboarding\",\"version\":\"1.0\",\"description\":\"Complete BYOV (Bring Your Own Vehicle) onboarding process for fleet technicians\",\"estimatedDuration\":45,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"van_management\",\"title\":\"Van Management\",\"description\":\"Handle permanent van reassignment for BYOV transition\",\"required\":true,\"estimatedTime\":15,\"category\":\"vehicle_management\",\"substeps\":[{\"id\":\"unassign_permanent_van\",\"title\":\"Unassign permanent van\",\"description\":\"Remove current permanent van assignment from technician\",\"required\":true},{\"id\":\"identify_assign_new_van_number\",\"title\":\"Identify and Assign new permanent van #\",\"description\":\"Locate and assign new permanent van number for BYOV vehicle\",\"required\":true}]},{\"id\":\"system_updates\",\"title\":\"System Updates\",\"description\":\"Update all fleet management systems with new van information\",\"required\":true,\"estimatedTime\":20,\"category\":\"system_action\",\"substeps\":[{\"id\":\"update_all_systems\",\"title\":\"Update all systems, tpms, holman, ams\",\"description\":\"Update TPMS, Holman, AMS and all other fleet systems with new van assignment\",\"required\":true},{\"id\":\"update_truck_address_notes\",\"title\":\"Update truck address and notes for the truck assignment and status\",\"description\":\"Update vehicle address, assignment notes, and status information in fleet systems\",\"required\":true}]},{\"id\":\"communication\",\"title\":\"Communication\",\"description\":\"Notify stakeholders of new van number assignment\",\"required\":true,\"estimatedTime\":10,\"category\":\"communication\",\"substeps\":[{\"id\":\"notify_original_submitter\",\"title\":\"Ensure the original submitter is aware of the correct van # to use in tech hub\",\"description\":\"Contact original submitter to provide new van number for tech hub usage\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"byov_approved\",\"label\":\"BYOV Vehicle Approved and Assigned\",\"requiresApproval\":false},{\"value\":\"requires_additional_documentation\",\"label\":\"Requires Additional Documentation\",\"requiresApproval\":false},{\"value\":\"vehicle_rejected\",\"label\":\"Vehicle Does Not Meet BYOV Requirements\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-17T00:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"byov\",\"onboarding\",\"fleet\",\"vehicle\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "fleet_create_vehicle_v1",
    "department": "FLEET",
    "workflowType": "create_vehicle",
    "version": "1.0",
    "name": "Vehicle Creation Process",
    "content": "{\"id\":\"fleet_create_vehicle_v1\",\"name\":\"Vehicle Creation Process\",\"department\":\"FLEET\",\"workflowType\":\"create_vehicle\",\"version\":\"1.0\",\"description\":\"Complete process for creating and registering a new fleet vehicle\",\"estimatedDuration\":90,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"vin_verification\",\"title\":\"VIN Verification and Validation\",\"description\":\"Verify and validate vehicle identification number\",\"required\":true,\"estimatedTime\":15,\"category\":\"verification\",\"attachmentRequired\":true,\"attachmentTypes\":[\"image\",\"document\"],\"substeps\":[{\"id\":\"verify_vin_format\",\"title\":\"Verify VIN format and structure\",\"description\":\"Confirm VIN follows standard 17-character format\",\"required\":true},{\"id\":\"decode_vin\",\"title\":\"Decode VIN information\",\"description\":\"Extract make, model, year, and other vehicle details from VIN\",\"required\":true},{\"id\":\"check_vin_database\",\"title\":\"Check VIN against national databases\",\"description\":\"Verify VIN is not reported stolen or has liens\",\"required\":true},{\"id\":\"photograph_vin\",\"title\":\"Photograph VIN plate\",\"description\":\"Take clear photo of VIN plate on dashboard and door jamb\",\"required\":true}]},{\"id\":\"vehicle_documentation\",\"title\":\"Vehicle Registration and Documentation\",\"description\":\"Gather and verify all required vehicle documentation\",\"required\":true,\"estimatedTime\":25,\"category\":\"documentation\",\"attachmentRequired\":true,\"attachmentTypes\":[\"document\"],\"substeps\":[{\"id\":\"verify_title\",\"title\":\"Verify vehicle title or MCO\",\"description\":\"Confirm clear title or manufacturer's certificate of origin\",\"required\":true},{\"id\":\"register_vehicle\",\"title\":\"Complete vehicle registration\",\"description\":\"Process registration with appropriate state DMV\",\"required\":true},{\"id\":\"obtain_plates\",\"title\":\"Obtain license plates\",\"description\":\"Secure appropriate fleet or commercial license plates\",\"required\":true},{\"id\":\"registration_documents\",\"title\":\"File registration documents\",\"description\":\"Organize and file all registration paperwork\",\"required\":true}]},{\"id\":\"insurance_setup\",\"title\":\"Insurance Verification and Setup\",\"description\":\"Establish insurance coverage for new vehicle\",\"required\":true,\"estimatedTime\":20,\"category\":\"verification\",\"substeps\":[{\"id\":\"add_to_policy\",\"title\":\"Add vehicle to fleet insurance policy\",\"description\":\"Contact insurance provider to add vehicle to coverage\",\"required\":true},{\"id\":\"verify_coverage\",\"title\":\"Verify adequate coverage levels\",\"description\":\"Confirm liability, comprehensive, and collision coverage\",\"required\":true},{\"id\":\"obtain_insurance_cards\",\"title\":\"Obtain insurance identification cards\",\"description\":\"Get physical and digital insurance cards for vehicle\",\"required\":true},{\"id\":\"file_insurance_docs\",\"title\":\"File insurance documentation\",\"description\":\"Store insurance documents in vehicle and fleet records\",\"required\":true}]},{\"id\":\"equipment_installation\",\"title\":\"Equipment Assignment and Installation\",\"description\":\"Install and configure required fleet equipment\",\"required\":true,\"estimatedTime\":20,\"category\":\"system_action\",\"substeps\":[{\"id\":\"install_gps\",\"title\":\"Install GPS tracking system\",\"description\":\"Mount and configure GPS tracking device\",\"required\":true},{\"id\":\"install_communication\",\"title\":\"Install communication equipment\",\"description\":\"Set up radio, phone mount, and other communication tools\",\"required\":true},{\"id\":\"install_safety_equipment\",\"title\":\"Install safety equipment\",\"description\":\"Add first aid kit, emergency equipment, and safety materials\",\"required\":true},{\"id\":\"add_tools_supplies\",\"title\":\"Load standard tools and supplies\",\"description\":\"Stock vehicle with required tools and operational supplies\",\"required\":true}]},{\"id\":\"final_inspection\",\"title\":\"Final Vehicle Inspection\",\"description\":\"Complete comprehensive inspection before fleet deployment\",\"required\":true,\"estimatedTime\":10,\"category\":\"inspection\",\"attachmentRequired\":true,\"attachmentTypes\":[\"image\",\"document\"],\"substeps\":[{\"id\":\"safety_inspection\",\"title\":\"Perform safety inspection\",\"description\":\"Check brakes, lights, tires, and all safety systems\",\"required\":true},{\"id\":\"equipment_test\",\"title\":\"Test all installed equipment\",\"description\":\"Verify GPS, communication, and safety equipment function properly\",\"required\":true},{\"id\":\"document_condition\",\"title\":\"Document vehicle condition\",\"description\":\"Record initial condition with photos and notes\",\"required\":true},{\"id\":\"create_vehicle_file\",\"title\":\"Create vehicle file\",\"description\":\"Establish complete vehicle record in fleet management system\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"active_ready\",\"label\":\"Vehicle Created and Ready for Assignment\",\"requiresApproval\":false},{\"value\":\"pending_equipment\",\"label\":\"Created - Pending Equipment Installation\",\"requiresApproval\":false},{\"value\":\"requires_supervisor_approval\",\"label\":\"Requires Supervisor Approval for Fleet Addition\",\"requiresApproval\":true},{\"value\":\"documentation_incomplete\",\"label\":\"Pending Additional Documentation\",\"requiresApproval\":false}]},\"metadata\":{\"createdAt\":\"2025-09-11T23:55:00Z\",\"createdBy\":\"system\",\"tags\":[\"vehicle\",\"creation\",\"fleet\",\"registration\",\"setup\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "fleet_decommission_vehicle_v1",
    "department": "FLEET",
    "workflowType": "decommission",
    "version": "1.0",
    "name": "Vehicle Decommission Process",
    "content": "{\"id\":\"fleet_decommission_vehicle_v1\",\"name\":\"Vehicle Decommission Process\",\"department\":\"FLEET\",\"workflowType\":\"decommission\",\"version\":\"1.0\",\"description\":\"Complete process for decommissioning a fleet vehicle\",\"estimatedDuration\":120,\"difficulty\":\"hard\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"vehicle_inspection\",\"title\":\"Final Vehicle Inspection\",\"description\":\"Comprehensive inspection before decommission\",\"required\":true,\"estimatedTime\":30,\"category\":\"inspection\",\"attachmentRequired\":true,\"attachmentTypes\":[\"image\",\"document\"],\"substeps\":[{\"id\":\"damage_assessment\",\"title\":\"Document all damage and wear\",\"description\":\"Photograph and record all damage, wear, or missing items\",\"required\":true},{\"id\":\"mileage_recording\",\"title\":\"Record final odometer reading\",\"description\":\"Document exact mileage at time of decommission\",\"required\":true},{\"id\":\"equipment_inventory\",\"title\":\"Inventory all vehicle equipment\",\"description\":\"Account for all tools, accessories, and add-on equipment\",\"required\":true}]},{\"id\":\"data_removal\",\"title\":\"Remove Vehicle Data and Equipment\",\"description\":\"Secure removal of company data and equipment\",\"required\":true,\"estimatedTime\":20,\"category\":\"system_action\",\"substeps\":[{\"id\":\"gps_removal\",\"title\":\"Remove GPS tracking devices\",\"description\":\"Uninstall and collect all GPS tracking equipment\",\"required\":true},{\"id\":\"data_wipe\",\"title\":\"Wipe electronic systems data\",\"description\":\"Clear any stored company data from vehicle systems\",\"required\":true},{\"id\":\"remove_branding\",\"title\":\"Remove company branding and decals\",\"description\":\"Strip all company logos, decals, and identifying marks\",\"required\":true}]},{\"id\":\"financial_processing\",\"title\":\"Process Financial Information\",\"description\":\"Handle financial aspects of decommission\",\"required\":true,\"estimatedTime\":25,\"category\":\"documentation\",\"substeps\":[{\"id\":\"calculate_book_value\",\"title\":\"Calculate remaining book value\",\"description\":\"Determine current depreciated value of vehicle\",\"required\":true},{\"id\":\"disposal_method\",\"title\":\"Determine disposal method\",\"description\":\"Decide if vehicle will be sold, auctioned, or scrapped\",\"required\":true},{\"id\":\"title_preparation\",\"title\":\"Prepare title transfer documentation\",\"description\":\"Gather and prepare all necessary title and ownership documents\",\"required\":true}]},{\"id\":\"system_updates\",\"title\":\"Update All Systems\",\"description\":\"Update vehicle status across all management systems\",\"required\":true,\"estimatedTime\":15,\"category\":\"system_action\",\"substeps\":[{\"id\":\"fleet_system_update\",\"title\":\"Update fleet management system\",\"description\":\"Change vehicle status to 'decommissioned' in fleet system\",\"required\":true},{\"id\":\"insurance_notification\",\"title\":\"Notify insurance company\",\"description\":\"Inform insurance carrier of vehicle decommission\",\"required\":true},{\"id\":\"registration_cancellation\",\"title\":\"Cancel vehicle registration\",\"description\":\"Process registration cancellation with DMV\",\"required\":true}]},{\"id\":\"final_documentation\",\"title\":\"Complete Final Documentation\",\"description\":\"Finalize all decommission paperwork\",\"required\":true,\"estimatedTime\":30,\"category\":\"documentation\",\"substeps\":[{\"id\":\"decommission_report\",\"title\":\"Generate decommission report\",\"description\":\"Create comprehensive report of decommission process\",\"required\":true},{\"id\":\"archive_records\",\"title\":\"Archive vehicle records\",\"description\":\"Move all vehicle records to archived status\",\"required\":true},{\"id\":\"notify_stakeholders\",\"title\":\"Notify all stakeholders\",\"description\":\"Send notifications to fleet management, finance, and other departments\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"decommissioned\",\"label\":\"Vehicle Successfully Decommissioned\",\"requiresApproval\":false},{\"value\":\"pending_sale\",\"label\":\"Decommissioned - Pending Sale/Auction\",\"requiresApproval\":false},{\"value\":\"requires_supervisor_approval\",\"label\":\"Requires Supervisor Approval for Disposal\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-01-11T23:20:00Z\",\"createdBy\":\"system\",\"tags\":[\"decommission\",\"vehicle\",\"fleet\",\"disposal\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "fleet_offboard_technician_v1",
    "department": "FLEET",
    "workflowType": "offboarding",
    "version": "1.0",
    "name": "Fleet Technician Offboarding Process",
    "content": "{\"id\":\"fleet_offboard_technician_v1\",\"name\":\"Fleet Technician Offboarding Process\",\"department\":\"FLEET\",\"workflowType\":\"offboarding\",\"version\":\"1.0\",\"description\":\"Complete fleet-related offboarding process for departing technicians\",\"estimatedDuration\":45,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"vehicle_return\",\"title\":\"Process Vehicle Return\",\"description\":\"Handle return and inspection of assigned company vehicle\",\"required\":true,\"estimatedTime\":20,\"category\":\"vehicle_processing\",\"substeps\":[{\"id\":\"inspect_vehicle_condition\",\"title\":\"Inspect vehicle condition\",\"description\":\"Perform thorough inspection of returned vehicle condition\",\"required\":true},{\"id\":\"check_mileage\",\"title\":\"Record final mileage\",\"description\":\"Document final odometer reading\",\"required\":true},{\"id\":\"collect_keys_documents\",\"title\":\"Collect keys and documents\",\"description\":\"Retrieve all keys, registration, and vehicle-related documents\",\"required\":true},{\"id\":\"update_fleet_system\",\"title\":\"Update fleet management system\",\"description\":\"Mark vehicle as returned and available for reassignment\",\"required\":true}]},{\"id\":\"equipment_retrieval\",\"title\":\"Retrieve Fleet Equipment\",\"description\":\"Collect all fleet-issued equipment and tools\",\"required\":true,\"estimatedTime\":15,\"category\":\"equipment\",\"substeps\":[{\"id\":\"inventory_tools\",\"title\":\"Inventory returned tools\",\"description\":\"Check all fleet-issued tools and equipment against inventory list\",\"required\":true},{\"id\":\"assess_equipment_condition\",\"title\":\"Assess equipment condition\",\"description\":\"Evaluate condition of returned equipment for damage or wear\",\"required\":true}]},{\"id\":\"final_documentation\",\"title\":\"Complete Final Documentation\",\"description\":\"Finalize all fleet-related offboarding paperwork\",\"required\":true,\"estimatedTime\":10,\"category\":\"documentation\",\"substeps\":[{\"id\":\"generate_return_report\",\"title\":\"Generate vehicle return report\",\"description\":\"Create detailed report of vehicle and equipment return\",\"required\":true},{\"id\":\"update_technician_record\",\"title\":\"Update technician fleet record\",\"description\":\"Mark technician as no longer having fleet assignments\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"completed\",\"label\":\"Fleet Offboarding Completed\",\"requiresApproval\":false},{\"value\":\"pending_equipment\",\"label\":\"Pending Equipment Return\",\"requiresApproval\":false},{\"value\":\"requires_damage_assessment\",\"label\":\"Requires Damage Assessment\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-01-11T23:50:00Z\",\"createdBy\":\"system\",\"tags\":[\"offboarding\",\"fleet\",\"vehicle\",\"equipment\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "fleet_offboarding_sequence_v1",
    "department": "FLEET",
    "workflowType": "offboarding_sequence",
    "version": "1.0",
    "name": "Fleet Technician Offboarding Sequence",
    "content": "{\"id\":\"fleet_offboarding_sequence_v1\",\"name\":\"Fleet Technician Offboarding Sequence\",\"department\":\"FLEET\",\"workflowType\":\"offboarding_sequence\",\"version\":\"1.0\",\"description\":\"Complete fleet management offboarding sequence for departing technicians\",\"estimatedDuration\":50,\"difficulty\":\"high\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"vehicle_return_coordination\",\"title\":\"Vehicle Return Coordination\",\"description\":\"Coordinate return of assigned fleet vehicles\",\"required\":true,\"estimatedTime\":25,\"category\":\"coordination\",\"substeps\":[{\"id\":\"schedule_vehicle_return\",\"title\":\"Schedule vehicle return\",\"description\":\"Arrange for return of all assigned fleet vehicles\",\"required\":true},{\"id\":\"conduct_vehicle_inspection\",\"title\":\"Conduct final vehicle inspection\",\"description\":\"Perform comprehensive inspection of returned vehicles\",\"required\":true},{\"id\":\"document_vehicle_condition\",\"title\":\"Document vehicle condition\",\"description\":\"Document current condition and any damage or maintenance needs\",\"required\":true},{\"id\":\"transfer_vehicle_keys_documents\",\"title\":\"Transfer vehicle keys and documents\",\"description\":\"Collect all vehicle keys, registration, and related documents\",\"required\":true}]},{\"id\":\"fleet_system_updates\",\"title\":\"Fleet System Updates\",\"description\":\"Update fleet management systems\",\"required\":true,\"estimatedTime\":20,\"category\":\"system_action\",\"substeps\":[{\"id\":\"update_vehicle_assignment_system\",\"title\":\"Update vehicle assignment system\",\"description\":\"Remove technician assignments from fleet management system\",\"required\":true},{\"id\":\"deactivate_vehicle_access_systems\",\"title\":\"Deactivate vehicle access systems\",\"description\":\"Deactivate any electronic access systems or tracking devices\",\"required\":true},{\"id\":\"update_insurance_records\",\"title\":\"Update insurance and liability records\",\"description\":\"Update insurance records to reflect change in vehicle assignment\",\"required\":true}]},{\"id\":\"final_fleet_reconciliation\",\"title\":\"Final Fleet Reconciliation\",\"description\":\"Complete final fleet asset reconciliation\",\"required\":true,\"estimatedTime\":5,\"category\":\"documentation\",\"substeps\":[{\"id\":\"generate_vehicle_return_report\",\"title\":\"Generate vehicle return report\",\"description\":\"Create comprehensive report of all returned fleet assets\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"fleet_assets_returned_complete\",\"label\":\"All Fleet Assets Returned - Complete\",\"requiresApproval\":false},{\"value\":\"damage_assessment_pending\",\"label\":\"Damage Assessment Pending\",\"requiresApproval\":false},{\"value\":\"requires_legal_collection\",\"label\":\"Requires Legal Collection Action\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-18T00:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"offboarding\",\"sequence\",\"fleet\",\"vehicles\",\"return\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "fleet_onboard_technician_v1",
    "department": "FLEET",
    "workflowType": "onboarding",
    "version": "1.0",
    "name": "Fleet Technician Onboarding",
    "content": "{\"id\":\"fleet_onboard_technician_v1\",\"name\":\"Fleet Technician Onboarding\",\"department\":\"FLEET\",\"workflowType\":\"onboarding\",\"version\":\"1.0\",\"description\":\"Complete onboarding process for new fleet technician\",\"estimatedDuration\":60,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"verify_documentation\",\"title\":\"Verify Required Documentation\",\"description\":\"Ensure all required documents are provided and valid\",\"required\":true,\"estimatedTime\":15,\"category\":\"verification\",\"substeps\":[{\"id\":\"check_drivers_license\",\"title\":\"Verify driver's license\",\"description\":\"Check license validity, class, and expiration date\",\"required\":true},{\"id\":\"review_mvr\",\"title\":\"Review Motor Vehicle Record (MVR)\",\"description\":\"Assess driving history for any violations or restrictions\",\"required\":true},{\"id\":\"verify_insurance\",\"title\":\"Confirm insurance documentation\",\"description\":\"Review proof of insurance and coverage limits\",\"required\":true},{\"id\":\"check_background\",\"title\":\"Verify background check completion\",\"description\":\"Confirm background check results are satisfactory\",\"required\":true}]},{\"id\":\"system_setup\",\"title\":\"Set Up System Access\",\"description\":\"Create accounts and configure system access\",\"required\":true,\"estimatedTime\":20,\"category\":\"system_action\",\"substeps\":[{\"id\":\"create_enterprise_id\",\"title\":\"Create Enterprise ID\",\"description\":\"Generate unique Enterprise ID for technician\",\"required\":true},{\"id\":\"setup_fleet_system_access\",\"title\":\"Configure fleet management system access\",\"description\":\"Grant appropriate permissions in fleet tracking system\",\"required\":true},{\"id\":\"assign_mobile_device\",\"title\":\"Assign mobile device and apps\",\"description\":\"Provide tablet/phone with required fleet management apps\",\"required\":true},{\"id\":\"setup_gps_tracking\",\"title\":\"Configure GPS tracking permissions\",\"description\":\"Set up vehicle and technician location tracking\",\"required\":true}]},{\"id\":\"training_completion\",\"title\":\"Complete Required Training\",\"description\":\"Ensure technician completes all mandatory training\",\"required\":true,\"estimatedTime\":15,\"category\":\"verification\",\"substeps\":[{\"id\":\"vehicle_safety_training\",\"title\":\"Complete vehicle safety training\",\"description\":\"Verify completion of commercial vehicle safety course\",\"required\":true},{\"id\":\"fleet_policy_training\",\"title\":\"Review fleet policies and procedures\",\"description\":\"Confirm understanding of fleet management policies\",\"required\":true},{\"id\":\"emergency_procedures\",\"title\":\"Emergency response training\",\"description\":\"Complete training on emergency procedures and contacts\",\"required\":true}]},{\"id\":\"finalize_onboarding\",\"title\":\"Finalize Onboarding Process\",\"description\":\"Complete final steps and communications\",\"required\":true,\"estimatedTime\":10,\"category\":\"documentation\",\"substeps\":[{\"id\":\"update_hr_system\",\"title\":\"Update HR system with fleet information\",\"description\":\"Ensure HR records reflect fleet assignment status\",\"required\":true},{\"id\":\"notify_management\",\"title\":\"Notify fleet management of new technician\",\"description\":\"Send notification to fleet supervisors and managers\",\"required\":true},{\"id\":\"schedule_first_assignment\",\"title\":\"Schedule initial vehicle assignment\",\"description\":\"Prepare for first vehicle assignment process\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"onboarded\",\"label\":\"Technician Successfully Onboarded\",\"requiresApproval\":false},{\"value\":\"pending_training\",\"label\":\"Pending Training Completion\",\"requiresApproval\":false},{\"value\":\"requires_additional_documentation\",\"label\":\"Requires Additional Documentation\",\"requiresApproval\":false}]},\"metadata\":{\"createdAt\":\"2025-01-11T23:20:00Z\",\"createdBy\":\"system\",\"tags\":[\"onboarding\",\"technician\",\"fleet\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "fleet_onboarding_day0_v1",
    "department": "FLEET",
    "workflowType": "onboarding_day0",
    "version": "1.0",
    "name": "Fleet Day 0 Technician Onboarding",
    "content": "{\"id\":\"fleet_onboarding_day0_v1\",\"name\":\"Fleet Day 0 Technician Onboarding\",\"department\":\"FLEET\",\"workflowType\":\"onboarding_day0\",\"version\":\"1.0\",\"description\":\"Critical Day 0 onboarding tasks for fleet technicians\",\"estimatedDuration\":30,\"difficulty\":\"high\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"vehicle_assignment_setup\",\"title\":\"Vehicle Assignment and System Setup\",\"description\":\"Complete vehicle assignment and update all critical systems\",\"required\":true,\"estimatedTime\":25,\"category\":\"system_action\",\"substeps\":[{\"id\":\"identify_assign_van\",\"title\":\"Identify and assign new permanent van #\",\"description\":\"Identify available vehicle and assign permanent van number to new technician\",\"required\":true},{\"id\":\"update_all_systems\",\"title\":\"Update all systems, TPMS, Holman, AMS\",\"description\":\"Update vehicle assignment in TPMS, Holman fleet management, and AMS systems\",\"required\":true},{\"id\":\"update_truck_address_tpms\",\"title\":\"Update truck address in TPMS\",\"description\":\"Update the assigned vehicle's service address and location information in TPMS\",\"required\":true},{\"id\":\"add_assignment_notes\",\"title\":\"Add notes for the truck assignment and status\",\"description\":\"Document vehicle assignment details, condition, and any special notes in the system\",\"required\":true},{\"id\":\"notify_original_submitter\",\"title\":\"Ensure the original submitter is aware of the correct van # to use\",\"description\":\"Contact and notify the original request submitter of the assigned vehicle number and details\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"day0_completed\",\"label\":\"Day 0 Onboarding Completed Successfully\",\"requiresApproval\":false},{\"value\":\"pending_system_access\",\"label\":\"Pending System Access Setup\",\"requiresApproval\":false},{\"value\":\"requires_escalation\",\"label\":\"Requires Management Escalation\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-17T00:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"onboarding\",\"day0\",\"fleet\",\"critical\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "fleet_unassign_van_v1",
    "department": "FLEET",
    "workflowType": "van_unassignment",
    "version": "1.0",
    "name": "Van Unassignment Process",
    "content": "{\"id\":\"fleet_unassign_van_v1\",\"name\":\"Van Unassignment Process\",\"department\":\"FLEET\",\"workflowType\":\"van_unassignment\",\"version\":\"1.0\",\"description\":\"Process for unassigning previous truck from technician\",\"estimatedDuration\":20,\"difficulty\":\"easy\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"remove_assignment\",\"title\":\"Remove Truck Assignment\",\"description\":\"Remove truck from technician's profile\",\"required\":true,\"estimatedTime\":5,\"category\":\"system_action\",\"substeps\":[{\"id\":\"update_tech_profile\",\"title\":\"Update technician profile\",\"description\":\"Remove truck assignment from technician's record\",\"required\":true},{\"id\":\"update_vehicle_status\",\"title\":\"Update vehicle status to 'unassigned'\",\"description\":\"Change vehicle status in fleet management system\",\"required\":true}]},{\"id\":\"schedule_return\",\"title\":\"Schedule Vehicle Return\",\"description\":\"Arrange for vehicle pickup or return\",\"required\":true,\"estimatedTime\":10,\"category\":\"coordination\",\"substeps\":[{\"id\":\"contact_technician\",\"title\":\"Contact technician for return scheduling\",\"description\":\"Coordinate with technician to schedule vehicle return\",\"required\":true},{\"id\":\"arrange_pickup\",\"title\":\"Arrange vehicle pickup or drop-off\",\"description\":\"Schedule logistics for vehicle collection\",\"required\":true},{\"id\":\"notify_stakeholders\",\"title\":\"Notify relevant departments\",\"description\":\"Inform other departments of pending vehicle return\",\"required\":true}]},{\"id\":\"update_records\",\"title\":\"Update Fleet Records\",\"description\":\"Complete documentation for vehicle unassignment\",\"required\":true,\"estimatedTime\":5,\"category\":\"documentation\",\"substeps\":[{\"id\":\"record_unassignment_date\",\"title\":\"Record unassignment effective date\",\"description\":\"Document when unassignment becomes effective\",\"required\":true},{\"id\":\"update_fleet_dashboard\",\"title\":\"Update fleet tracking dashboard\",\"description\":\"Ensure unassignment appears on fleet management dashboard\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"unassigned\",\"label\":\"Vehicle Successfully Unassigned\",\"requiresApproval\":false},{\"value\":\"pending_return\",\"label\":\"Pending Vehicle Return\",\"requiresApproval\":false},{\"value\":\"requires_follow_up\",\"label\":\"Requires Follow-up Action\",\"requiresApproval\":false}]},\"metadata\":{\"createdAt\":\"2025-09-12T05:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"van\",\"unassignment\",\"fleet\",\"return\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "fleet_update_systems_v1",
    "department": "FLEET",
    "workflowType": "system_updates",
    "version": "1.0",
    "name": "Fleet Systems Update Process",
    "content": "{\"id\":\"fleet_update_systems_v1\",\"name\":\"Fleet Systems Update Process\",\"department\":\"FLEET\",\"workflowType\":\"system_updates\",\"version\":\"1.0\",\"description\":\"Update TPMS, AMS, and Holman systems for vehicle transition\",\"estimatedDuration\":25,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"update_tpms\",\"title\":\"Update TPMS (Truck Parts Management System)\",\"description\":\"Update parts management system with new vehicle information\",\"required\":true,\"estimatedTime\":10,\"category\":\"system_action\",\"substeps\":[{\"id\":\"remove_old_vehicle_tpms\",\"title\":\"Remove old vehicle from TPMS\",\"description\":\"Remove previous truck from parts management system\",\"required\":true},{\"id\":\"add_new_vehicle_tpms\",\"title\":\"Add new BYOV to TPMS\",\"description\":\"Enter new BYOV vehicle into parts management system\",\"required\":true},{\"id\":\"verify_tpms_update\",\"title\":\"Verify TPMS update completed\",\"description\":\"Confirm changes are properly reflected in TPMS\",\"required\":true}]},{\"id\":\"update_ams\",\"title\":\"Update AMS (Asset Management System)\",\"description\":\"Update asset management system records\",\"required\":true,\"estimatedTime\":8,\"category\":\"system_action\",\"substeps\":[{\"id\":\"update_asset_records\",\"title\":\"Update asset management records\",\"description\":\"Modify asset tracking for vehicle transition\",\"required\":true},{\"id\":\"transfer_equipment_records\",\"title\":\"Transfer equipment assignments\",\"description\":\"Move equipment assignments from old to new vehicle\",\"required\":true},{\"id\":\"verify_ams_update\",\"title\":\"Verify AMS update completed\",\"description\":\"Confirm changes are properly reflected in AMS\",\"required\":true}]},{\"id\":\"update_holman\",\"title\":\"Update Holman Fleet System\",\"description\":\"Update Holman fleet management system\",\"required\":true,\"estimatedTime\":7,\"category\":\"system_action\",\"substeps\":[{\"id\":\"update_holman_records\",\"title\":\"Update Holman fleet records\",\"description\":\"Modify fleet tracking in Holman system\",\"required\":true},{\"id\":\"sync_vehicle_data\",\"title\":\"Sync vehicle data across systems\",\"description\":\"Ensure all systems have consistent vehicle information\",\"required\":true},{\"id\":\"verify_holman_update\",\"title\":\"Verify Holman update completed\",\"description\":\"Confirm changes are properly reflected in Holman system\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"systems_updated\",\"label\":\"All Systems Successfully Updated\",\"requiresApproval\":false},{\"value\":\"partial_update\",\"label\":\"Partial Update - Some Systems Pending\",\"requiresApproval\":false},{\"value\":\"requires_technical_support\",\"label\":\"Requires Technical Support\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-12T05:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"systems\",\"tpms\",\"ams\",\"holman\",\"fleet\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "inventory_assign_vehicle_v1",
    "department": "INVENTORY",
    "workflowType": "vehicle_assignment",
    "version": "1.0",
    "name": "Inventory Vehicle Assignment Process",
    "content": "{\"id\":\"inventory_assign_vehicle_v1\",\"name\":\"Inventory Vehicle Assignment Process\",\"department\":\"INVENTORY\",\"workflowType\":\"vehicle_assignment\",\"version\":\"1.0\",\"description\":\"Vehicle assignment process from inventory perspective\",\"estimatedDuration\":30,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"verify_inventory_status\",\"title\":\"Verify Vehicle Inventory Status\",\"description\":\"Check vehicle availability in inventory system\",\"required\":true,\"estimatedTime\":10,\"category\":\"verification\",\"substeps\":[{\"id\":\"check_stock_status\",\"title\":\"Verify vehicle stock status\",\"description\":\"Confirm vehicle is in available inventory\",\"required\":true},{\"id\":\"validate_condition\",\"title\":\"Validate vehicle condition\",\"description\":\"Check vehicle condition matches assignment requirements\",\"required\":true}]},{\"id\":\"process_assignment\",\"title\":\"Process Assignment Documentation\",\"description\":\"Update inventory records for vehicle assignment\",\"required\":true,\"estimatedTime\":15,\"category\":\"documentation\",\"substeps\":[{\"id\":\"update_inventory_record\",\"title\":\"Update inventory system\",\"description\":\"Mark vehicle as assigned in inventory database\",\"required\":true},{\"id\":\"create_assignment_record\",\"title\":\"Create assignment documentation\",\"description\":\"Generate assignment paperwork and records\",\"required\":true}]},{\"id\":\"notify_departments\",\"title\":\"Notify Relevant Departments\",\"description\":\"Send notifications about vehicle assignment\",\"required\":true,\"estimatedTime\":5,\"category\":\"communication\",\"substeps\":[{\"id\":\"notify_fleet\",\"title\":\"Notify fleet management\",\"description\":\"Inform fleet management of assignment\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"assigned\",\"label\":\"Vehicle Successfully Assigned\",\"requiresApproval\":false},{\"value\":\"pending_documentation\",\"label\":\"Pending Documentation\",\"requiresApproval\":false}]},\"metadata\":{\"createdAt\":\"2025-01-11T23:45:00Z\",\"createdBy\":\"system\",\"tags\":[\"vehicle\",\"assignment\",\"inventory\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "inventory_byov_inspection_v1",
    "department": "INVENTORY",
    "workflowType": "byov_assignment",
    "version": "1.0",
    "name": "Inventory BYOV Equipment Assessment",
    "content": "{\"id\":\"inventory_byov_inspection_v1\",\"name\":\"Inventory BYOV Equipment Assessment\",\"department\":\"INVENTORY\",\"workflowType\":\"byov_assignment\",\"version\":\"1.0\",\"description\":\"Inventory assessment for BYOV program to determine equipment needs\",\"estimatedDuration\":30,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"vehicle_storage_assessment\",\"title\":\"Assess Vehicle Storage Capacity\",\"description\":\"Evaluate vehicle's ability to store required equipment\",\"required\":true,\"estimatedTime\":15,\"category\":\"assessment\",\"substeps\":[{\"id\":\"measure_cargo_space\",\"title\":\"Measure available cargo space\",\"description\":\"Assess dimensions and capacity of vehicle storage areas\",\"required\":true},{\"id\":\"evaluate_storage_security\",\"title\":\"Evaluate storage security\",\"description\":\"Check security features for equipment protection\",\"required\":true},{\"id\":\"check_equipment_compatibility\",\"title\":\"Check equipment compatibility\",\"description\":\"Verify vehicle can accommodate standard equipment\",\"required\":true}]},{\"id\":\"inventory_allocation\",\"title\":\"Determine Inventory Allocation\",\"description\":\"Decide what inventory items to allocate for BYOV setup\",\"required\":true,\"estimatedTime\":10,\"category\":\"planning\",\"substeps\":[{\"id\":\"create_equipment_list\",\"title\":\"Create required equipment list\",\"description\":\"Generate list of equipment needed for technician role\",\"required\":true},{\"id\":\"check_inventory_availability\",\"title\":\"Check inventory availability\",\"description\":\"Verify equipment is available for allocation\",\"required\":true}]},{\"id\":\"allocation_documentation\",\"title\":\"Document Inventory Allocation\",\"description\":\"Create documentation for BYOV inventory allocation\",\"required\":true,\"estimatedTime\":5,\"category\":\"documentation\",\"substeps\":[{\"id\":\"generate_allocation_record\",\"title\":\"Generate allocation record\",\"description\":\"Create formal record of equipment allocation for BYOV\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"approved\",\"label\":\"BYOV Approved for Inventory Allocation\",\"requiresApproval\":false},{\"value\":\"insufficient_storage\",\"label\":\"Insufficient Storage Capacity\",\"requiresApproval\":false}]},\"metadata\":{\"createdAt\":\"2025-01-11T23:55:00Z\",\"createdBy\":\"system\",\"tags\":[\"byov\",\"inventory\",\"assessment\",\"equipment\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "inventory_byov_onboarding_v1",
    "department": "INVENTORY",
    "workflowType": "byov_onboarding",
    "version": "1.0",
    "name": "Inventory BYOV Technician Onboarding",
    "content": "{\"id\":\"inventory_byov_onboarding_v1\",\"name\":\"Inventory BYOV Technician Onboarding\",\"department\":\"INVENTORY\",\"workflowType\":\"byov_onboarding\",\"version\":\"1.0\",\"description\":\"Inventory management onboarding process for Bring Your Own Vehicle technicians\",\"estimatedDuration\":25,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"byov_parts_allocation\",\"title\":\"BYOV Parts Allocation\",\"description\":\"Allocate parts inventory suitable for BYOV operations\",\"required\":true,\"estimatedTime\":15,\"category\":\"system_action\",\"substeps\":[{\"id\":\"determine_starter_parts_kit\",\"title\":\"Determine starter parts kit\",\"description\":\"Select appropriate starter parts inventory for BYOV technician\",\"required\":true},{\"id\":\"configure_mobile_parts_storage\",\"title\":\"Configure mobile parts storage solution\",\"description\":\"Set up mobile storage solution for parts inventory in personal vehicle\",\"required\":true},{\"id\":\"establish_parts_replenishment_schedule\",\"title\":\"Establish parts replenishment schedule\",\"description\":\"Define schedule and method for parts inventory replenishment\",\"required\":true}]},{\"id\":\"byov_inventory_tracking\",\"title\":\"BYOV Inventory Tracking Setup\",\"description\":\"Set up inventory tracking for BYOV operations\",\"required\":true,\"estimatedTime\":10,\"category\":\"verification\",\"substeps\":[{\"id\":\"configure_mobile_inventory_system\",\"title\":\"Configure mobile inventory tracking\",\"description\":\"Set up mobile inventory tracking system for BYOV technician\",\"required\":true},{\"id\":\"establish_inventory_accountability\",\"title\":\"Establish inventory accountability protocols\",\"description\":\"Define protocols for regular inventory counts and accountability\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"byov_inventory_assigned\",\"label\":\"BYOV Inventory Assigned Complete\",\"requiresApproval\":false},{\"value\":\"pending_parts_delivery\",\"label\":\"Pending Parts Delivery\",\"requiresApproval\":false},{\"value\":\"requires_inventory_manager_approval\",\"label\":\"Requires Inventory Manager Approval\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-18T00:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"byov\",\"onboarding\",\"inventory\",\"mobile_storage\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "inventory_offboard_technician_v1",
    "department": "INVENTORY",
    "workflowType": "offboarding",
    "version": "1.0",
    "name": "Inventory Technician Offboarding Process",
    "content": "{\"id\":\"inventory_offboard_technician_v1\",\"name\":\"Inventory Technician Offboarding Process\",\"department\":\"INVENTORY\",\"workflowType\":\"offboarding\",\"version\":\"1.0\",\"description\":\"Inventory-related offboarding process for departing technicians\",\"estimatedDuration\":30,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"inventory_return\",\"title\":\"Process Inventory Returns\",\"description\":\"Handle return of all assigned inventory items\",\"required\":true,\"estimatedTime\":15,\"category\":\"inventory_processing\",\"substeps\":[{\"id\":\"scan_returned_items\",\"title\":\"Scan all returned items\",\"description\":\"Scan barcodes/tags of all returned inventory items\",\"required\":true},{\"id\":\"verify_item_condition\",\"title\":\"Verify condition of returned items\",\"description\":\"Inspect condition and functionality of returned items\",\"required\":true},{\"id\":\"update_inventory_system\",\"title\":\"Update inventory management system\",\"description\":\"Mark items as returned and available for reallocation\",\"required\":true}]},{\"id\":\"reconcile_assignments\",\"title\":\"Reconcile Outstanding Assignments\",\"description\":\"Verify all assigned items are accounted for\",\"required\":true,\"estimatedTime\":10,\"category\":\"reconciliation\",\"substeps\":[{\"id\":\"check_assignment_list\",\"title\":\"Check technician assignment list\",\"description\":\"Review all items assigned to departing technician\",\"required\":true},{\"id\":\"identify_missing_items\",\"title\":\"Identify any missing items\",\"description\":\"Document any items not returned by technician\",\"required\":true}]},{\"id\":\"finalize_inventory_record\",\"title\":\"Finalize Inventory Record\",\"description\":\"Complete inventory-related offboarding documentation\",\"required\":true,\"estimatedTime\":5,\"category\":\"documentation\",\"substeps\":[{\"id\":\"close_technician_assignments\",\"title\":\"Close all technician assignments\",\"description\":\"Formally close all inventory assignments for technician\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"completed\",\"label\":\"Inventory Offboarding Completed\",\"requiresApproval\":false},{\"value\":\"missing_items\",\"label\":\"Missing Items - Requires Follow-up\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-01-11T23:50:00Z\",\"createdBy\":\"system\",\"tags\":[\"offboarding\",\"inventory\",\"equipment\",\"return\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "inventory_offboarding_sequence_v1",
    "department": "INVENTORY",
    "workflowType": "offboarding_sequence",
    "version": "1.0",
    "name": "Inventory Technician Offboarding Sequence",
    "content": "{\"id\":\"inventory_offboarding_sequence_v1\",\"name\":\"Inventory Technician Offboarding Sequence\",\"department\":\"INVENTORY\",\"workflowType\":\"offboarding_sequence\",\"version\":\"1.0\",\"description\":\"Complete inventory management offboarding sequence for departing technicians\",\"estimatedDuration\":35,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"parts_inventory_reconciliation\",\"title\":\"Parts Inventory Reconciliation\",\"description\":\"Reconcile all assigned parts and inventory items\",\"required\":true,\"estimatedTime\":20,\"category\":\"verification\",\"substeps\":[{\"id\":\"count_assigned_parts\",\"title\":\"Count all assigned parts inventory\",\"description\":\"Perform physical count of all parts assigned to technician\",\"required\":true},{\"id\":\"validate_parts_usage_logs\",\"title\":\"Validate parts usage logs\",\"description\":\"Review and validate all parts usage documentation and logs\",\"required\":true},{\"id\":\"identify_discrepancies\",\"title\":\"Identify inventory discrepancies\",\"description\":\"Document any discrepancies between assigned and actual inventory\",\"required\":true}]},{\"id\":\"inventory_return_processing\",\"title\":\"Inventory Return Processing\",\"description\":\"Process return of all inventory items\",\"required\":true,\"estimatedTime\":10,\"category\":\"system_action\",\"substeps\":[{\"id\":\"schedule_inventory_pickup\",\"title\":\"Schedule inventory pickup\",\"description\":\"Arrange for collection of all remaining inventory items\",\"required\":true},{\"id\":\"update_inventory_system\",\"title\":\"Update inventory management system\",\"description\":\"Update inventory system with returned items and final counts\",\"required\":true}]},{\"id\":\"final_documentation\",\"title\":\"Final Documentation\",\"description\":\"Complete final inventory documentation\",\"required\":true,\"estimatedTime\":5,\"category\":\"documentation\",\"substeps\":[{\"id\":\"generate_final_inventory_report\",\"title\":\"Generate final inventory reconciliation report\",\"description\":\"Create comprehensive report of inventory status and any outstanding items\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"inventory_reconciled_complete\",\"label\":\"Inventory Fully Reconciled - Complete\",\"requiresApproval\":false},{\"value\":\"discrepancies_noted\",\"label\":\"Discrepancies Noted - Investigation Required\",\"requiresApproval\":false},{\"value\":\"requires_manager_review\",\"label\":\"Requires Manager Review\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-18T00:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"offboarding\",\"sequence\",\"inventory\",\"reconciliation\",\"parts\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "inventory_onboard_technician_v1",
    "department": "INVENTORY",
    "workflowType": "onboarding",
    "version": "1.0",
    "name": "Inventory Technician Onboarding",
    "content": "{\"id\":\"inventory_onboard_technician_v1\",\"name\":\"Inventory Technician Onboarding\",\"department\":\"INVENTORY\",\"workflowType\":\"onboarding\",\"version\":\"1.0\",\"description\":\"Complete onboarding process for inventory management technician\",\"estimatedDuration\":45,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"verify_credentials\",\"title\":\"Verify Technician Credentials\",\"description\":\"Confirm required certifications and background checks\",\"required\":true,\"estimatedTime\":10,\"category\":\"verification\",\"substeps\":[{\"id\":\"check_background\",\"title\":\"Verify background check completion\",\"description\":\"Confirm clean background check for inventory access\",\"required\":true},{\"id\":\"verify_certifications\",\"title\":\"Check relevant certifications\",\"description\":\"Verify any industry-specific certifications required\",\"required\":true},{\"id\":\"confirm_drug_screening\",\"title\":\"Confirm drug screening results\",\"description\":\"Verify satisfactory drug screening completion\",\"required\":true}]},{\"id\":\"inventory_system_setup\",\"title\":\"Set Up Inventory System Access\",\"description\":\"Configure access to inventory management systems\",\"required\":true,\"estimatedTime\":20,\"category\":\"system_action\",\"substeps\":[{\"id\":\"create_inventory_login\",\"title\":\"Create inventory system login\",\"description\":\"Set up username and password for inventory management system\",\"required\":true},{\"id\":\"assign_permissions\",\"title\":\"Assign appropriate permissions\",\"description\":\"Configure access levels based on role and responsibilities\",\"required\":true},{\"id\":\"setup_barcode_scanner\",\"title\":\"Configure barcode scanning equipment\",\"description\":\"Assign and configure handheld barcode scanners\",\"required\":true},{\"id\":\"assign_warehouse_zones\",\"title\":\"Assign warehouse zones\",\"description\":\"Define which warehouse areas technician will manage\",\"required\":true}]},{\"id\":\"inventory_training\",\"title\":\"Complete Inventory Training\",\"description\":\"Ensure completion of all inventory-specific training\",\"required\":true,\"estimatedTime\":10,\"category\":\"verification\",\"substeps\":[{\"id\":\"inventory_procedures\",\"title\":\"Complete inventory procedures training\",\"description\":\"Learn cycle counting, receiving, and shipping procedures\",\"required\":true},{\"id\":\"system_training\",\"title\":\"Complete inventory system training\",\"description\":\"Learn to use inventory management software effectively\",\"required\":true}]},{\"id\":\"complete_setup\",\"title\":\"Complete Onboarding Setup\",\"description\":\"Finalize all onboarding requirements\",\"required\":true,\"estimatedTime\":5,\"category\":\"documentation\",\"substeps\":[{\"id\":\"update_personnel_records\",\"title\":\"Update personnel database\",\"description\":\"Add technician to inventory department roster\",\"required\":true},{\"id\":\"assign_mentor\",\"title\":\"Assign experienced mentor\",\"description\":\"Pair with experienced technician for initial guidance\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"onboarded\",\"label\":\"Technician Successfully Onboarded\",\"requiresApproval\":false},{\"value\":\"pending_training\",\"label\":\"Pending Training Completion\",\"requiresApproval\":false},{\"value\":\"requires_additional_verification\",\"label\":\"Requires Additional Verification\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-01-11T23:20:00Z\",\"createdBy\":\"system\",\"tags\":[\"onboarding\",\"technician\",\"inventory\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "inventory_onboarding_day0_v1",
    "department": "INVENTORY",
    "workflowType": "onboarding_day0",
    "version": "1.0",
    "name": "Inventory Day 0 Technician Onboarding",
    "content": "{\"id\":\"inventory_onboarding_day0_v1\",\"name\":\"Inventory Day 0 Technician Onboarding\",\"department\":\"INVENTORY\",\"workflowType\":\"onboarding_day0\",\"version\":\"1.0\",\"description\":\"Critical Day 0 inventory management onboarding tasks\",\"estimatedDuration\":20,\"difficulty\":\"high\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"tpms_setup_shipment_verification\",\"title\":\"TPMS Setup and Shipment Verification\",\"description\":\"Add technician to TPMS and verify shipment information\",\"required\":true,\"estimatedTime\":10,\"category\":\"system_action\",\"substeps\":[{\"id\":\"add_technician_tpms_confirm_shipment\",\"title\":\"Add technician to TPMS and confirm shipment information\",\"description\":\"Add new technician to TPMS system and verify all shipment and delivery information is accurate\",\"required\":true}]},{\"id\":\"inventory_count_scheduling\",\"title\":\"Inventory Count Scheduling\",\"description\":\"Schedule comprehensive inventory count process\",\"required\":true,\"estimatedTime\":10,\"category\":\"system_action\",\"substeps\":[{\"id\":\"schedule_full_count_inventory\",\"title\":\"Schedule full count inventory count\",\"description\":\"Schedule and coordinate a comprehensive full count inventory process for the new technician's assigned areas\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"day0_inventory_completed\",\"label\":\"Day 0 Inventory Setup Completed\",\"requiresApproval\":false},{\"value\":\"pending_inventory_count\",\"label\":\"Pending Inventory Count Scheduling\",\"requiresApproval\":false},{\"value\":\"requires_verification\",\"label\":\"Requires Additional System Verification\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-17T00:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"onboarding\",\"day0\",\"inventory\",\"critical\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "inventory_onboarding_v1",
    "department": "INVENTORY",
    "workflowType": "onboarding_general",
    "version": "1.0",
    "name": "Inventory Management Technician Onboarding",
    "content": "{\"id\":\"inventory_onboarding_v1\",\"name\":\"Inventory Management Technician Onboarding\",\"department\":\"INVENTORY\",\"workflowType\":\"onboarding_general\",\"version\":\"1.0\",\"description\":\"Comprehensive inventory management onboarding process\",\"estimatedDuration\":55,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"credentials_verification\",\"title\":\"Complete Credential Verification\",\"description\":\"Verify all required credentials and clearances\",\"required\":true,\"estimatedTime\":15,\"category\":\"verification\",\"substeps\":[{\"id\":\"background_check_review\",\"title\":\"Review background check results\",\"description\":\"Confirm satisfactory background check for inventory access\",\"required\":true},{\"id\":\"security_clearance_verification\",\"title\":\"Verify security clearance levels\",\"description\":\"Confirm appropriate security clearance for inventory responsibilities\",\"required\":true},{\"id\":\"drug_screening_confirmation\",\"title\":\"Confirm drug screening completion\",\"description\":\"Verify satisfactory drug screening results\",\"required\":true}]},{\"id\":\"inventory_system_configuration\",\"title\":\"Configure Inventory System Access\",\"description\":\"Setup comprehensive inventory system access and permissions\",\"required\":true,\"estimatedTime\":25,\"category\":\"system_action\",\"substeps\":[{\"id\":\"create_inventory_accounts\",\"title\":\"Create inventory system accounts\",\"description\":\"Setup login credentials for all inventory management systems\",\"required\":true},{\"id\":\"configure_access_permissions\",\"title\":\"Configure role-based access permissions\",\"description\":\"Set appropriate access levels based on role and responsibilities\",\"required\":true},{\"id\":\"setup_barcode_equipment\",\"title\":\"Setup barcode scanning equipment\",\"description\":\"Configure and test handheld barcode scanners and mobile devices\",\"required\":true},{\"id\":\"assign_warehouse_zones\",\"title\":\"Assign warehouse management zones\",\"description\":\"Define specific warehouse areas and inventory zones for management\",\"required\":true},{\"id\":\"configure_reporting_access\",\"title\":\"Configure reporting and analytics access\",\"description\":\"Setup access to inventory reports and analytics dashboards\",\"required\":true}]},{\"id\":\"comprehensive_training\",\"title\":\"Complete Comprehensive Inventory Training\",\"description\":\"Complete all required training modules for inventory management\",\"required\":true,\"estimatedTime\":10,\"category\":\"verification\",\"substeps\":[{\"id\":\"inventory_procedures_training\",\"title\":\"Complete inventory procedures training\",\"description\":\"Complete training on cycle counting, receiving, and shipping procedures\",\"required\":true},{\"id\":\"safety_compliance_training\",\"title\":\"Complete safety and compliance training\",\"description\":\"Complete warehouse safety and regulatory compliance training\",\"required\":true}]},{\"id\":\"finalize_onboarding_process\",\"title\":\"Finalize Onboarding Setup\",\"description\":\"Complete final onboarding tasks and documentation\",\"required\":true,\"estimatedTime\":5,\"category\":\"documentation\",\"substeps\":[{\"id\":\"update_personnel_database\",\"title\":\"Update personnel and HR database\",\"description\":\"Add technician to inventory department personnel records\",\"required\":true},{\"id\":\"assign_mentor_guidance\",\"title\":\"Assign mentor for ongoing guidance\",\"description\":\"Pair new technician with experienced mentor for initial guidance period\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"fully_onboarded\",\"label\":\"Technician Fully Onboarded and Ready\",\"requiresApproval\":false},{\"value\":\"pending_training_completion\",\"label\":\"Pending Training Module Completion\",\"requiresApproval\":false},{\"value\":\"requires_additional_verification\",\"label\":\"Requires Additional Security Verification\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-17T00:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"onboarding\",\"inventory\",\"comprehensive\",\"management\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "inventory_process_decommission_v1",
    "department": "INVENTORY",
    "workflowType": "decommission",
    "version": "1.0",
    "name": "Process Vehicle Decommission",
    "content": "{\"id\":\"inventory_process_decommission_v1\",\"name\":\"Process Vehicle Decommission\",\"department\":\"INVENTORY\",\"workflowType\":\"decommission\",\"version\":\"1.0\",\"description\":\"Inventory management process for vehicle decommission\",\"estimatedDuration\":60,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"inventory_assessment\",\"title\":\"Assess Vehicle Inventory\",\"description\":\"Evaluate all inventory items associated with vehicle\",\"required\":true,\"estimatedTime\":20,\"category\":\"inspection\",\"substeps\":[{\"id\":\"parts_inventory\",\"title\":\"Inventory all removable parts\",\"description\":\"Catalog all parts that can be salvaged for reuse\",\"required\":true},{\"id\":\"tool_recovery\",\"title\":\"Recover all company tools\",\"description\":\"Collect and account for all tools assigned to vehicle\",\"required\":true},{\"id\":\"supply_collection\",\"title\":\"Collect remaining supplies\",\"description\":\"Gather any unused supplies or materials\",\"required\":true}]},{\"id\":\"categorize_items\",\"title\":\"Categorize Recoverable Items\",\"description\":\"Sort items by condition and reuse potential\",\"required\":true,\"estimatedTime\":15,\"category\":\"documentation\",\"substeps\":[{\"id\":\"reusable_parts\",\"title\":\"Identify reusable parts\",\"description\":\"Mark parts in good condition for reuse in other vehicles\",\"required\":true},{\"id\":\"sellable_items\",\"title\":\"Identify sellable items\",\"description\":\"Mark items that can be sold to recover value\",\"required\":true},{\"id\":\"scrap_items\",\"title\":\"Identify scrap/disposal items\",\"description\":\"Mark items for scrap or proper disposal\",\"required\":true}]},{\"id\":\"update_inventory_system\",\"title\":\"Update Inventory Management System\",\"description\":\"Process all inventory changes in system\",\"required\":true,\"estimatedTime\":20,\"category\":\"system_action\",\"substeps\":[{\"id\":\"check_in_reusable\",\"title\":\"Check reusable items back into inventory\",\"description\":\"Add recoverable items back to available inventory\",\"required\":true},{\"id\":\"schedule_disposal\",\"title\":\"Schedule disposal of unusable items\",\"description\":\"Arrange proper disposal for items that cannot be reused\",\"required\":true},{\"id\":\"update_vehicle_status\",\"title\":\"Update vehicle inventory status\",\"description\":\"Mark vehicle as decommissioned in inventory system\",\"required\":true}]},{\"id\":\"documentation_completion\",\"title\":\"Complete Documentation\",\"description\":\"Finalize all inventory documentation\",\"required\":true,\"estimatedTime\":5,\"category\":\"documentation\",\"substeps\":[{\"id\":\"generate_recovery_report\",\"title\":\"Generate inventory recovery report\",\"description\":\"Create detailed report of all recovered items\",\"required\":true},{\"id\":\"submit_to_finance\",\"title\":\"Submit financial impact report\",\"description\":\"Provide finance team with recovery value information\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"processed\",\"label\":\"Decommission Inventory Successfully Processed\",\"requiresApproval\":false},{\"value\":\"pending_disposal\",\"label\":\"Pending Final Disposal Actions\",\"requiresApproval\":false},{\"value\":\"requires_additional_assessment\",\"label\":\"Requires Additional Value Assessment\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-01-11T23:20:00Z\",\"createdBy\":\"system\",\"tags\":[\"decommission\",\"inventory\",\"recovery\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "ntao_assign_vehicle_v1",
    "department": "NTAO",
    "workflowType": "vehicle_assignment",
    "version": "1.0",
    "name": "NTAO Vehicle Assignment Process",
    "content": "{\"id\":\"ntao_assign_vehicle_v1\",\"name\":\"NTAO Vehicle Assignment Process\",\"department\":\"NTAO\",\"workflowType\":\"vehicle_assignment\",\"version\":\"1.0\",\"description\":\"Vehicle assignment process from NTAO operational perspective\",\"estimatedDuration\":25,\"difficulty\":\"easy\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"operational_verification\",\"title\":\"Operational Verification\",\"description\":\"Verify operational readiness for assignment\",\"required\":true,\"estimatedTime\":10,\"category\":\"verification\",\"substeps\":[{\"id\":\"check_technician_status\",\"title\":\"Check technician operational status\",\"description\":\"Verify technician is active and assignment-eligible\",\"required\":true},{\"id\":\"verify_territory_match\",\"title\":\"Verify territory match\",\"description\":\"Confirm vehicle assignment aligns with service territory\",\"required\":true}]},{\"id\":\"assignment_coordination\",\"title\":\"Coordinate Assignment\",\"description\":\"Coordinate assignment with operational requirements\",\"required\":true,\"estimatedTime\":10,\"category\":\"coordination\",\"substeps\":[{\"id\":\"schedule_handover\",\"title\":\"Schedule vehicle handover\",\"description\":\"Coordinate timing of vehicle handover to technician\",\"required\":true},{\"id\":\"update_routing_system\",\"title\":\"Update routing system\",\"description\":\"Update service routing with new vehicle assignment\",\"required\":true}]},{\"id\":\"operational_notification\",\"title\":\"Send Operational Notifications\",\"description\":\"Notify operations team of assignment\",\"required\":true,\"estimatedTime\":5,\"category\":\"communication\",\"substeps\":[{\"id\":\"notify_dispatch\",\"title\":\"Notify dispatch team\",\"description\":\"Inform dispatch of new vehicle assignment\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"assigned\",\"label\":\"Vehicle Operationally Assigned\",\"requiresApproval\":false},{\"value\":\"pending_coordination\",\"label\":\"Pending Operational Coordination\",\"requiresApproval\":false}]},\"metadata\":{\"createdAt\":\"2025-01-11T23:45:00Z\",\"createdBy\":\"system\",\"tags\":[\"vehicle\",\"assignment\",\"ntao\",\"operations\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "ntao_byov_inspection_v1",
    "department": "NTAO",
    "workflowType": "byov_assignment",
    "version": "1.0",
    "name": "NTAO BYOV Operational Assessment",
    "content": "{\"id\":\"ntao_byov_inspection_v1\",\"name\":\"NTAO BYOV Operational Assessment\",\"department\":\"NTAO\",\"workflowType\":\"byov_assignment\",\"version\":\"1.0\",\"description\":\"NTAO operational assessment for BYOV program suitability\",\"estimatedDuration\":25,\"difficulty\":\"easy\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"stop_current_operations\",\"title\":\"Stop Current Operations\",\"description\":\"Halt all current shipments and orders for original van\",\"required\":true,\"estimatedTime\":10,\"category\":\"operational_stop\",\"substeps\":[{\"id\":\"stop_shipment_original_van\",\"title\":\"Stop shipment to original van\",\"description\":\"Halt all active shipments directed to the original van\",\"required\":true},{\"id\":\"cancel_back_order_parts\",\"title\":\"Cancel all back order parts\",\"description\":\"Cancel all pending back order parts for the original van\",\"required\":true}]},{\"id\":\"vehicle_assessment_new_setup\",\"title\":\"Vehicle Assessment and New Setup\",\"description\":\"Assess vehicle requirements and initiate new truck stock shipment\",\"required\":true,\"estimatedTime\":15,\"category\":\"operational_setup\",\"substeps\":[{\"id\":\"verify_vehicle_details_truck_stock\",\"title\":\"Verify vehicle details to identify the ideal truck stock\",\"description\":\"Review vehicle specifications to determine appropriate truck stock configuration\",\"required\":true},{\"id\":\"start_shipment_new_truck_stock\",\"title\":\"Start shipment of new truck stock to new byov\",\"description\":\"Initiate shipment of appropriate truck stock to the new BYOV vehicle\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"approved\",\"label\":\"BYOV Operationally Approved\",\"requiresApproval\":false},{\"value\":\"requires_modifications\",\"label\":\"Requires Operational Modifications\",\"requiresApproval\":false}]},\"metadata\":{\"createdAt\":\"2025-01-11T23:55:00Z\",\"createdBy\":\"system\",\"tags\":[\"byov\",\"ntao\",\"operations\",\"assessment\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "ntao_byov_onboarding_v1",
    "department": "NTAO",
    "workflowType": "byov_onboarding",
    "version": "1.0",
    "name": "NTAO BYOV Technician Onboarding",
    "content": "{\"id\":\"ntao_byov_onboarding_v1\",\"name\":\"NTAO BYOV Technician Onboarding\",\"department\":\"NTAO\",\"workflowType\":\"byov_onboarding\",\"version\":\"1.0\",\"description\":\"NTAO operational onboarding process for Bring Your Own Vehicle technicians\",\"estimatedDuration\":25,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"byov_territory_setup\",\"title\":\"BYOV Territory Setup\",\"description\":\"Configure territory and routing for BYOV technician\",\"required\":true,\"estimatedTime\":15,\"category\":\"system_action\",\"substeps\":[{\"id\":\"assign_byov_territory\",\"title\":\"Assign BYOV-appropriate territory\",\"description\":\"Assign territory suitable for personal vehicle operation\",\"required\":true},{\"id\":\"configure_byov_routing\",\"title\":\"Configure BYOV routing parameters\",\"description\":\"Set up routing optimized for personal vehicle use\",\"required\":true},{\"id\":\"validate_coverage_capacity\",\"title\":\"Validate BYOV coverage capacity\",\"description\":\"Ensure territory size is appropriate for BYOV operations\",\"required\":true}]},{\"id\":\"byov_operational_coordination\",\"title\":\"BYOV Operational Coordination\",\"description\":\"Coordinate BYOV-specific operational requirements\",\"required\":true,\"estimatedTime\":10,\"category\":\"coordination\",\"substeps\":[{\"id\":\"setup_byov_dispatch_protocols\",\"title\":\"Set up BYOV dispatch protocols\",\"description\":\"Configure dispatch protocols specific to BYOV operations\",\"required\":true},{\"id\":\"coordinate_equipment_delivery\",\"title\":\"Coordinate equipment delivery method\",\"description\":\"Arrange for delivery of company equipment to BYOV technician\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"byov_operational_ready\",\"label\":\"BYOV Operations Ready\",\"requiresApproval\":false},{\"value\":\"pending_territory_adjustment\",\"label\":\"Pending Territory Adjustment\",\"requiresApproval\":false},{\"value\":\"requires_operational_review\",\"label\":\"Requires Operational Review\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-18T00:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"byov\",\"onboarding\",\"ntao\",\"personal_vehicle\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "ntao_decommission_v1",
    "department": "NTAO",
    "workflowType": "decommission",
    "version": "1.0",
    "name": "NTAO Vehicle Decommission Process",
    "content": "{\"id\":\"ntao_decommission_v1\",\"name\":\"NTAO Vehicle Decommission Process\",\"department\":\"NTAO\",\"workflowType\":\"decommission\",\"version\":\"1.0\",\"description\":\"NTAO operational process for vehicle decommissioning\",\"estimatedDuration\":30,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"operational_impact_assessment\",\"title\":\"Operational Impact Assessment\",\"description\":\"Assess operational impact of vehicle decommission\",\"required\":true,\"estimatedTime\":15,\"category\":\"verification\",\"substeps\":[{\"id\":\"review_service_territory_impact\",\"title\":\"Review service territory impact\",\"description\":\"Analyze impact on service territory coverage and capacity\",\"required\":true},{\"id\":\"identify_replacement_coverage\",\"title\":\"Identify replacement coverage options\",\"description\":\"Determine alternative coverage solutions for affected territory\",\"required\":true},{\"id\":\"assess_technician_reassignment\",\"title\":\"Assess technician reassignment needs\",\"description\":\"Evaluate need for technician reassignment to maintain coverage\",\"required\":true}]},{\"id\":\"service_transition_coordination\",\"title\":\"Service Transition Coordination\",\"description\":\"Coordinate service transition and coverage adjustments\",\"required\":true,\"estimatedTime\":10,\"category\":\"coordination\",\"substeps\":[{\"id\":\"update_dispatch_routing\",\"title\":\"Update dispatch routing systems\",\"description\":\"Adjust routing and dispatch systems for decommissioned vehicle\",\"required\":true},{\"id\":\"communicate_service_changes\",\"title\":\"Communicate service changes to stakeholders\",\"description\":\"Notify relevant stakeholders of service coverage changes\",\"required\":true}]},{\"id\":\"operational_documentation\",\"title\":\"Operational Documentation\",\"description\":\"Document operational changes and updates\",\"required\":true,\"estimatedTime\":5,\"category\":\"documentation\",\"substeps\":[{\"id\":\"update_operational_records\",\"title\":\"Update operational records\",\"description\":\"Update all operational records to reflect vehicle decommission\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"operational_decommission_complete\",\"label\":\"Operational Decommission Complete\",\"requiresApproval\":false},{\"value\":\"coverage_adjustment_pending\",\"label\":\"Coverage Adjustment Pending\",\"requiresApproval\":false},{\"value\":\"requires_management_approval\",\"label\":\"Requires Management Approval\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-18T00:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"decommission\",\"ntao\",\"operational\",\"coverage\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "ntao_offboard_technician_v1",
    "department": "NTAO",
    "workflowType": "offboarding",
    "version": "1.0",
    "name": "NTAO Technician Offboarding Process",
    "content": "{\"id\":\"ntao_offboard_technician_v1\",\"name\":\"NTAO Technician Offboarding Process\",\"department\":\"NTAO\",\"workflowType\":\"offboarding\",\"version\":\"1.0\",\"description\":\"NTAO operational offboarding process for departing technicians\",\"estimatedDuration\":25,\"difficulty\":\"easy\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"operational_transition\",\"title\":\"Operational Transition\",\"description\":\"Handle operational aspects of technician departure\",\"required\":true,\"estimatedTime\":15,\"category\":\"system_action\",\"substeps\":[{\"id\":\"reassign_open_tickets\",\"title\":\"Reassign open service tickets\",\"description\":\"Transfer any open service tickets to other technicians\",\"required\":true},{\"id\":\"update_service_territory\",\"title\":\"Update service territory coverage\",\"description\":\"Adjust service territory assignments for coverage\",\"required\":true},{\"id\":\"notify_customers\",\"title\":\"Notify affected customers\",\"description\":\"Inform customers of technician change if needed\",\"required\":true}]},{\"id\":\"system_access_removal\",\"title\":\"Remove System Access\",\"description\":\"Deactivate operational system access\",\"required\":true,\"estimatedTime\":5,\"category\":\"system_action\",\"substeps\":[{\"id\":\"deactivate_routing_access\",\"title\":\"Deactivate routing system access\",\"description\":\"Remove technician from service routing systems\",\"required\":true}]},{\"id\":\"final_operational_documentation\",\"title\":\"Complete Operational Documentation\",\"description\":\"Finalize operational offboarding documentation\",\"required\":true,\"estimatedTime\":5,\"category\":\"documentation\",\"substeps\":[{\"id\":\"update_technician_status\",\"title\":\"Update technician operational status\",\"description\":\"Mark technician as inactive in operational systems\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"completed\",\"label\":\"NTAO Offboarding Completed\",\"requiresApproval\":false},{\"value\":\"pending_ticket_reassignment\",\"label\":\"Pending Ticket Reassignment\",\"requiresApproval\":false}]},\"metadata\":{\"createdAt\":\"2025-01-11T23:50:00Z\",\"createdBy\":\"system\",\"tags\":[\"offboarding\",\"ntao\",\"operations\",\"transition\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "ntao_offboarding_sequence_v1",
    "department": "NTAO",
    "workflowType": "offboarding_sequence",
    "version": "1.0",
    "name": "NTAO Technician Offboarding Sequence",
    "content": "{\"id\":\"ntao_offboarding_sequence_v1\",\"name\":\"NTAO Technician Offboarding Sequence\",\"department\":\"NTAO\",\"workflowType\":\"offboarding_sequence\",\"version\":\"1.0\",\"description\":\"Complete NTAO operational offboarding sequence for departing technicians\",\"estimatedDuration\":40,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"territory_handover\",\"title\":\"Territory Handover Coordination\",\"description\":\"Coordinate territory handover to maintain service continuity\",\"required\":true,\"estimatedTime\":20,\"category\":\"coordination\",\"substeps\":[{\"id\":\"identify_coverage_replacement\",\"title\":\"Identify coverage replacement\",\"description\":\"Determine temporary or permanent replacement for service territory\",\"required\":true},{\"id\":\"redistribute_active_appointments\",\"title\":\"Redistribute active appointments\",\"description\":\"Reassign all active and scheduled appointments to other technicians\",\"required\":true},{\"id\":\"update_territory_boundaries\",\"title\":\"Update territory boundaries\",\"description\":\"Adjust territory boundaries to maintain optimal coverage\",\"required\":true}]},{\"id\":\"operational_deactivation\",\"title\":\"Operational Systems Deactivation\",\"description\":\"Deactivate operational systems and access\",\"required\":true,\"estimatedTime\":15,\"category\":\"system_action\",\"substeps\":[{\"id\":\"deactivate_dispatch_access\",\"title\":\"Deactivate dispatch system access\",\"description\":\"Remove technician access from dispatch and routing systems\",\"required\":true},{\"id\":\"update_capacity_models\",\"title\":\"Update operational capacity models\",\"description\":\"Adjust capacity planning to reflect reduced technician availability\",\"required\":true},{\"id\":\"archive_service_history\",\"title\":\"Archive service history and performance data\",\"description\":\"Properly archive technician service history for record keeping\",\"required\":true}]},{\"id\":\"stakeholder_communication\",\"title\":\"Stakeholder Communication\",\"description\":\"Communicate departure to operational stakeholders\",\"required\":true,\"estimatedTime\":5,\"category\":\"communication\",\"substeps\":[{\"id\":\"notify_operations_team\",\"title\":\"Notify operations management team\",\"description\":\"Inform operations team of technician departure and coverage adjustments\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"offboarding_complete\",\"label\":\"NTAO Offboarding Complete\",\"requiresApproval\":false},{\"value\":\"pending_coverage\",\"label\":\"Pending Coverage Arrangement\",\"requiresApproval\":false},{\"value\":\"requires_escalation\",\"label\":\"Requires Management Escalation\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-18T00:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"offboarding\",\"sequence\",\"ntao\",\"operational\",\"territory\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "ntao_onboard_technician_v1",
    "department": "NTAO",
    "workflowType": "onboarding",
    "version": "1.0",
    "name": "NTAO Technician Onboarding",
    "content": "{\"id\":\"ntao_onboard_technician_v1\",\"name\":\"NTAO Technician Onboarding\",\"department\":\"NTAO\",\"workflowType\":\"onboarding\",\"version\":\"1.0\",\"description\":\"NTAO operations onboarding process for new technicians\",\"estimatedDuration\":35,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"operational_setup\",\"title\":\"Operational Setup\",\"description\":\"Set up technician in operational systems\",\"required\":true,\"estimatedTime\":15,\"category\":\"system_action\",\"substeps\":[{\"id\":\"create_tech_record\",\"title\":\"Create technician record\",\"description\":\"Create new technician record in NTAO operational systems\",\"required\":true},{\"id\":\"assign_territory\",\"title\":\"Assign service territory\",\"description\":\"Assign appropriate service territory based on location and capacity\",\"required\":true},{\"id\":\"setup_routing\",\"title\":\"Set up routing access\",\"description\":\"Configure routing system access for technician\",\"required\":true}]},{\"id\":\"credentials_access\",\"title\":\"Credentials & System Access\",\"description\":\"Provide necessary credentials and system access\",\"required\":true,\"estimatedTime\":10,\"category\":\"system_action\",\"substeps\":[{\"id\":\"create_login_credentials\",\"title\":\"Create login credentials\",\"description\":\"Set up technician login credentials for operational systems\",\"required\":true},{\"id\":\"assign_mobile_access\",\"title\":\"Assign mobile access\",\"description\":\"Configure mobile app access for field operations\",\"required\":true}]},{\"id\":\"operational_verification\",\"title\":\"Operational Verification\",\"description\":\"Verify technician operational readiness\",\"required\":true,\"estimatedTime\":10,\"category\":\"verification\",\"substeps\":[{\"id\":\"verify_service_specialties\",\"title\":\"Verify service specialties\",\"description\":\"Confirm technician specialties align with territorial needs\",\"required\":true},{\"id\":\"verify_schedule_availability\",\"title\":\"Verify schedule availability\",\"description\":\"Confirm technician availability matches service demand\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"onboarded\",\"label\":\"Technician Successfully Onboarded to NTAO\",\"requiresApproval\":false},{\"value\":\"pending_advanced_training\",\"label\":\"Pending Advanced Training Completion\",\"requiresApproval\":false},{\"value\":\"requires_additional_certification\",\"label\":\"Requires Additional Technical Certification\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-01-11T23:20:00Z\",\"createdBy\":\"system\",\"tags\":[\"onboarding\",\"technician\",\"ntao\",\"network\",\"optimization\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "ntao_onboarding_day0_v1",
    "department": "NTAO",
    "workflowType": "onboarding_day0",
    "version": "1.0",
    "name": "NTAO Day 0 Technician Onboarding",
    "content": "{\"id\":\"ntao_onboarding_day0_v1\",\"name\":\"NTAO Day 0 Technician Onboarding\",\"department\":\"NTAO\",\"workflowType\":\"onboarding_day0\",\"version\":\"1.0\",\"description\":\"Critical Day 0 NTAO operational tasks for new technician onboarding\",\"estimatedDuration\":35,\"difficulty\":\"high\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"territory_assignment\",\"title\":\"Territory Assignment and Setup\",\"description\":\"Assign service territory and configure operational parameters\",\"required\":true,\"estimatedTime\":15,\"category\":\"system_action\",\"substeps\":[{\"id\":\"assign_service_territory\",\"title\":\"Assign service territory to new technician\",\"description\":\"Assign appropriate service territory based on location and capacity\",\"required\":true},{\"id\":\"configure_routing_profile\",\"title\":\"Configure routing profile in dispatch system\",\"description\":\"Set up technician routing profile for optimal service delivery\",\"required\":true},{\"id\":\"validate_service_area_coverage\",\"title\":\"Validate service area coverage\",\"description\":\"Ensure assigned territory provides appropriate service coverage\",\"required\":true}]},{\"id\":\"operational_setup\",\"title\":\"Operational Systems Setup\",\"description\":\"Configure operational systems and communication channels\",\"required\":true,\"estimatedTime\":15,\"category\":\"system_action\",\"substeps\":[{\"id\":\"setup_dispatch_communication\",\"title\":\"Set up dispatch communication channel\",\"description\":\"Configure communication systems for dispatch coordination\",\"required\":true},{\"id\":\"configure_service_scheduling\",\"title\":\"Configure service scheduling parameters\",\"description\":\"Set up scheduling parameters for optimal service delivery\",\"required\":true},{\"id\":\"enable_real_time_tracking\",\"title\":\"Enable real-time tracking and monitoring\",\"description\":\"Activate tracking systems for operational visibility\",\"required\":true}]},{\"id\":\"notification_coordination\",\"title\":\"Stakeholder Notifications\",\"description\":\"Notify relevant operational stakeholders\",\"required\":true,\"estimatedTime\":5,\"category\":\"communication\",\"substeps\":[{\"id\":\"notify_dispatch_team\",\"title\":\"Notify dispatch team of new technician\",\"description\":\"Inform dispatch team of new technician availability and territory coverage\",\"required\":true},{\"id\":\"update_capacity_planning\",\"title\":\"Update operational capacity planning\",\"description\":\"Adjust capacity planning models with new technician availability\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"day0_operational_ready\",\"label\":\"Day 0 Operational Setup Complete\",\"requiresApproval\":false},{\"value\":\"pending_territory_assignment\",\"label\":\"Pending Territory Assignment\",\"requiresApproval\":false},{\"value\":\"requires_coordination\",\"label\":\"Requires Additional Operational Coordination\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-18T00:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"onboarding\",\"day0\",\"ntao\",\"critical\",\"operational\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "ntao_setup_shipment_v1",
    "department": "NTAO",
    "workflowType": "setup_shipment",
    "version": "1.0",
    "name": "Setup New BYOV Shipment Process",
    "content": "{\"id\":\"ntao_setup_shipment_v1\",\"name\":\"Setup New BYOV Shipment Process\",\"department\":\"NTAO\",\"workflowType\":\"setup_shipment\",\"version\":\"1.0\",\"description\":\"Setup parts shipment routing for new BYOV vehicle\",\"estimatedDuration\":20,\"difficulty\":\"medium\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"wait_van_assignment\",\"title\":\"Wait for Van Number Assignment\",\"description\":\"Wait for FLEET to assign new van number\",\"required\":true,\"estimatedTime\":5,\"category\":\"coordination\",\"substeps\":[{\"id\":\"check_van_assignment_status\",\"title\":\"Check van assignment status\",\"description\":\"Verify that new van number has been assigned by FLEET\",\"required\":true},{\"id\":\"confirm_van_details\",\"title\":\"Confirm new van details\",\"description\":\"Verify van number and technician assignment details\",\"required\":true}]},{\"id\":\"setup_shipping_profile\",\"title\":\"Setup Shipping Profile\",\"description\":\"Create shipping profile for new BYOV vehicle\",\"required\":true,\"estimatedTime\":10,\"category\":\"system_action\",\"substeps\":[{\"id\":\"create_vehicle_shipping_profile\",\"title\":\"Create vehicle shipping profile\",\"description\":\"Set up new vehicle in shipping management system\",\"required\":true},{\"id\":\"configure_delivery_address\",\"title\":\"Configure delivery address\",\"description\":\"Set up delivery location for parts shipments\",\"required\":true},{\"id\":\"setup_routing_preferences\",\"title\":\"Setup routing and delivery preferences\",\"description\":\"Configure preferred delivery methods and timing\",\"required\":true}]},{\"id\":\"test_workflow\",\"title\":\"Test Shipment Workflow\",\"description\":\"Verify new shipment process works correctly\",\"required\":true,\"estimatedTime\":5,\"category\":\"verification\",\"substeps\":[{\"id\":\"run_test_shipment\",\"title\":\"Run test shipment process\",\"description\":\"Test that shipment routing works for new vehicle\",\"required\":true},{\"id\":\"verify_inventory_connection\",\"title\":\"Verify inventory management connection\",\"description\":\"Confirm new vehicle appears in inventory management system\",\"required\":true},{\"id\":\"confirm_workflow_active\",\"title\":\"Confirm workflow is active\",\"description\":\"Verify that shipments can now be processed for new vehicle\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"shipment_setup_complete\",\"label\":\"Shipment Setup Successfully Completed\",\"requiresApproval\":false},{\"value\":\"pending_van_assignment\",\"label\":\"Pending Van Number Assignment\",\"requiresApproval\":false},{\"value\":\"requires_technical_support\",\"label\":\"Requires Technical Support\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-12T05:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"shipment\",\"setup\",\"ntao\",\"byov\"],\"isActive\":true}}",
    "isActive": true
  }
,
  {
    "id": "ntao_stop_shipment_v1",
    "department": "NTAO",
    "workflowType": "stop_shipment",
    "version": "1.0",
    "name": "Stop Parts Shipment Process",
    "content": "{\"id\":\"ntao_stop_shipment_v1\",\"name\":\"Stop Parts Shipment Process\",\"department\":\"NTAO\",\"workflowType\":\"stop_shipment\",\"version\":\"1.0\",\"description\":\"Stop all parts shipments to previous vehicle\",\"estimatedDuration\":10,\"difficulty\":\"easy\",\"requiredRole\":\"field\",\"steps\":[{\"id\":\"halt_shipments\",\"title\":\"Halt All Scheduled Shipments\",\"description\":\"Stop all pending and future shipments to old vehicle\",\"required\":true,\"estimatedTime\":8,\"category\":\"system_action\",\"substeps\":[{\"id\":\"identify_pending_shipments\",\"title\":\"Identify all pending shipments\",\"description\":\"Find all scheduled shipments to the old truck number\",\"required\":true},{\"id\":\"cancel_pending_orders\",\"title\":\"Cancel pending parts orders\",\"description\":\"Stop all parts orders scheduled for delivery to old vehicle\",\"required\":true},{\"id\":\"update_shipping_system\",\"title\":\"Update shipping system status\",\"description\":\"Mark old vehicle as inactive for shipping purposes\",\"required\":true}]},{\"id\":\"document_changes\",\"title\":\"Document Shipment Changes\",\"description\":\"Record all shipment modifications and reasons\",\"required\":true,\"estimatedTime\":2,\"category\":\"documentation\",\"substeps\":[{\"id\":\"log_shipment_halt\",\"title\":\"Log shipment halt in system\",\"description\":\"Record when and why shipments were stopped\",\"required\":true}]}],\"finalDisposition\":{\"required\":true,\"options\":[{\"value\":\"shipments_stopped\",\"label\":\"All Shipments Successfully Stopped\",\"requiresApproval\":false},{\"value\":\"partial_stop\",\"label\":\"Some Shipments May Still Be Pending\",\"requiresApproval\":false},{\"value\":\"requires_escalation\",\"label\":\"Requires Escalation to Supervisor\",\"requiresApproval\":true}]},\"metadata\":{\"createdAt\":\"2025-09-12T05:00:00Z\",\"createdBy\":\"system\",\"tags\":[\"shipment\",\"stop\",\"ntao\",\"parts\"],\"isActive\":true}}",
    "isActive": true
  }

];

// Template lookup by ID for quick access - main export for production use
export const EMBEDDED_TEMPLATES: Record<string, InsertTemplateWithId> = {
  "assets_assign_vehicle_v1": EMBEDDED_TEMPLATES_ARRAY[0]
,
  "assets_byov_inspection_v1": EMBEDDED_TEMPLATES_ARRAY[1]
,
  "assets_byov_onboarding_v1": EMBEDDED_TEMPLATES_ARRAY[2]
,
  "assets_decommission_v1": EMBEDDED_TEMPLATES_ARRAY[3]
,
  "assets_offboard_technician_v1": EMBEDDED_TEMPLATES_ARRAY[4]
,
  "assets_offboarding_sequence_v1": EMBEDDED_TEMPLATES_ARRAY[5]
,
  "assets_onboard_technician_v1": EMBEDDED_TEMPLATES_ARRAY[6]
,
  "assets_onboarding_day0_v1": EMBEDDED_TEMPLATES_ARRAY[7]
,
  "assets_onboarding_day1_5_v1": EMBEDDED_TEMPLATES_ARRAY[8]
,
  "fleet_assign_van_v1": EMBEDDED_TEMPLATES_ARRAY[9]
,
  "fleet_assign_vehicle_v1": EMBEDDED_TEMPLATES_ARRAY[10]
,
  "fleet_byov_assignment_v1": EMBEDDED_TEMPLATES_ARRAY[11]
,
  "fleet_byov_onboarding_v1": EMBEDDED_TEMPLATES_ARRAY[12]
,
  "fleet_create_vehicle_v1": EMBEDDED_TEMPLATES_ARRAY[13]
,
  "fleet_decommission_vehicle_v1": EMBEDDED_TEMPLATES_ARRAY[14]
,
  "fleet_offboard_technician_v1": EMBEDDED_TEMPLATES_ARRAY[15]
,
  "fleet_offboarding_sequence_v1": EMBEDDED_TEMPLATES_ARRAY[16]
,
  "fleet_onboard_technician_v1": EMBEDDED_TEMPLATES_ARRAY[17]
,
  "fleet_onboarding_day0_v1": EMBEDDED_TEMPLATES_ARRAY[18]
,
  "fleet_unassign_van_v1": EMBEDDED_TEMPLATES_ARRAY[19]
,
  "fleet_update_systems_v1": EMBEDDED_TEMPLATES_ARRAY[20]
,
  "inventory_assign_vehicle_v1": EMBEDDED_TEMPLATES_ARRAY[21]
,
  "inventory_byov_inspection_v1": EMBEDDED_TEMPLATES_ARRAY[22]
,
  "inventory_byov_onboarding_v1": EMBEDDED_TEMPLATES_ARRAY[23]
,
  "inventory_offboard_technician_v1": EMBEDDED_TEMPLATES_ARRAY[24]
,
  "inventory_offboarding_sequence_v1": EMBEDDED_TEMPLATES_ARRAY[25]
,
  "inventory_onboard_technician_v1": EMBEDDED_TEMPLATES_ARRAY[26]
,
  "inventory_onboarding_day0_v1": EMBEDDED_TEMPLATES_ARRAY[27]
,
  "inventory_onboarding_v1": EMBEDDED_TEMPLATES_ARRAY[28]
,
  "inventory_process_decommission_v1": EMBEDDED_TEMPLATES_ARRAY[29]
,
  "ntao_assign_vehicle_v1": EMBEDDED_TEMPLATES_ARRAY[30]
,
  "ntao_byov_inspection_v1": EMBEDDED_TEMPLATES_ARRAY[31]
,
  "ntao_byov_onboarding_v1": EMBEDDED_TEMPLATES_ARRAY[32]
,
  "ntao_decommission_v1": EMBEDDED_TEMPLATES_ARRAY[33]
,
  "ntao_offboard_technician_v1": EMBEDDED_TEMPLATES_ARRAY[34]
,
  "ntao_offboarding_sequence_v1": EMBEDDED_TEMPLATES_ARRAY[35]
,
  "ntao_onboard_technician_v1": EMBEDDED_TEMPLATES_ARRAY[36]
,
  "ntao_onboarding_day0_v1": EMBEDDED_TEMPLATES_ARRAY[37]
,
  "ntao_setup_shipment_v1": EMBEDDED_TEMPLATES_ARRAY[38]
,
  "ntao_stop_shipment_v1": EMBEDDED_TEMPLATES_ARRAY[39]
};
