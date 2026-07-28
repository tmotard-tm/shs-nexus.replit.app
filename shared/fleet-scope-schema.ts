import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, boolean, serial, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Main status categories (11 categories)
export const MAIN_STATUSES = [
  "Confirming Status",
  "Decision Pending",
  "Repairing",
  "Declined Repair",
  "Approved for sale",
  "Tags",
  "Scheduling",
  "PMF",
  "In Transit",
  "On Road",
  "Needs truck assigned",
  "Available to be assigned",
  "Relocate Van",
  "NLWC - Return Rental",
  "Truck Swap"
] as const;

export type MainStatus = typeof MAIN_STATUSES[number];

// Sub-statuses mapped to main statuses (25 total sub-statuses)
// Note: "Ordering duplicate tags" is available for all statuses (auto-set when Reg. Sticker = "Ordered duplicates")
export const SUB_STATUSES: Record<MainStatus, readonly string[]> = {
  "Confirming Status": [
    "SHS Confirming",
    "SHS Researching",
    "Holman Confirming",
    "Location Unknown",
    "Awaiting Tech Response",
    "Declined Repair",
    "Estimate Pending Decision",
    "Ordering duplicate tags"
  ],
  "Decision Pending": [
    "Awaiting estimate from shop",
    "Estimate received, needs review",
    "Repair approved",
    "Repair declined",
    "Ordering duplicate tags"
  ],
  "Repairing": [
    "Under repair at shop",
    "Waiting on repair completion",
    "Ordering duplicate tags"
  ],
  "Declined Repair": [
    "Vehicle in process of being decommissioned",
    "Vehicle submitted for sale",
    "Vehicle was sold",
    "Ordering duplicate tags"
  ],
  "Approved for sale": [
    "Clearing Softeon Inventory",
    "Vehicle Termination Form completed",
    "Termination Form Approved",
    "Fleet Administrator review",
    "Procurement to transfer form to leadership",
    "Leadership to approve Docusign",
    "Declined Docusign",
    "Ordering duplicate tags"
  ],
  "Tags": [
    "Needs tag/registration",
    "Registration renewal in progress",
    "Tags/registration complete",
    "Mailed to tech needs a slot booked",
    "Ordering duplicate tags"
  ],
  "Scheduling": [
    "To be scheduled for tech pickup",
    "Scheduled, awaiting tech pickup",
    "Ordering duplicate tags"
  ],
  "PMF": [
    "In transit to PMF",
    "Undergoing work at PMF",
    "Ready for redeployment",
    "Ordering duplicate tags"
  ],
  "In Transit": [
    "Being transported to technician",
    "Ordering duplicate tags"
  ],
  "On Road": [
    "Delivered to technician",
    "Other tech swiped van",
    "Ordering duplicate tags"
  ],
  "Needs truck assigned": [
    "Ordering duplicate tags"
  ],
  "Available to be assigned": [
    "Ordering duplicate tags"
  ],
  "Relocate Van": [
    "Ordering duplicate tags"
  ],
  "NLWC - Return Rental": [
    "Ordering duplicate tags"
  ],
  "Truck Swap": [
    "Ordering duplicate tags"
  ]
} as const;

// Registration sticker valid options
export const REGISTRATION_STICKER_OPTIONS = [
  "Yes",
  "Expired",
  "Shop would not check",
  "Mailed Tag",
  "Contacted tech",
  "Unknown"
] as const;

export type RegistrationStickerStatus = typeof REGISTRATION_STICKER_OPTIONS[number];

// Repair or Sale Decision options
export const REPAIR_OR_SALE_OPTIONS = [
  "Repair",
  "Sale"
] as const;

export type RepairOrSaleDecision = typeof REPAIR_OR_SALE_OPTIONS[number];

// Helper to get combined display status - uses comma separator like Excel
export function getCombinedStatus(mainStatus: string, subStatus: string | null): string {
  if (!subStatus) return mainStatus;
  return `${mainStatus}, ${subStatus}`;
}

/**
 * Normalizes SHS owner names to ONE canonical spelling per person.
 * The Action Tracker shows one card per distinct value, so every variation
 * ("OLga", "Olga", "Olga F.") must collapse to the same string.
 * Rob A / Rob C / Rob D / Rob G are DIFFERENT people and stay separate;
 * "Rob Anderson"/"Rob And" = Rob A and "Robert Delgado" = Rob D (confirmed by ops).
 * SINGLE SOURCE OF TRUTH — used by client grouping (Action Tracker, Dashboard),
 * server truck writes (fleet-scope-storage), and the idempotent startup data
 * heal (fleet-scope-schema-init). Do not fork per-page copies of this logic.
 */
export function normalizeOwnerName(owner: string | null | undefined): string {
  if (!owner || owner.trim() === "") {
    return "Oscar S"; // Default owner
  }

  // Trim, collapse internal whitespace, strip trailing periods
  let normalized = owner.trim().replace(/\s+/g, " ");
  while (normalized.endsWith(".")) {
    normalized = normalized.slice(0, -1).trim();
  }

  const lower = normalized.toLowerCase();

  // Rob family — A/C/D/G are different people, keep them separate
  if (lower === "rob a" || lower.startsWith("rob a ") || lower.startsWith("rob and")) return "Rob A"; // incl. "Rob Anderson", "Rob And"
  if (lower === "rob c") return "Rob C";
  if (lower === "rob d" || lower.startsWith("robert d")) return "Rob D"; // incl. "Robert Delgado"
  if (lower === "rob g") return "Rob G";

  if (lower.includes("oscar")) return "Oscar S";
  if (lower.startsWith("olga")) return "Olga F"; // "Olga", "OLga", "Olga F."
  if (lower.startsWith("jenn")) return "Jenn D"; // "Jennifer", "Jenn D.", "Jenn D"
  // John C and Mandy R were removed from the team (July 2026) — their vehicles
  // and future Tags/Scheduling work go to Oscar S (confirmed by ops).
  if (lower.startsWith("john c")) return "Oscar S";
  if (lower.startsWith("samantha w")) return "Samantha W";
  if (lower.startsWith("mandy r")) return "Oscar S";
  if (lower.startsWith("cheryl")) return "Cheryl";
  if (lower.startsWith("bob b")) return "Bob B";
  if (lower === "luca b") return "Luca B";
  if (lower === "sean c") return "Sean C";

  return normalized;
}

// Migration mapping: Old statuses to new structure
export const OLD_TO_NEW_STATUS_MAP: Record<string, { mainStatus: MainStatus; subStatus: string }> = {
  // Confirming Status mappings
  "Research required": { mainStatus: "Confirming Status", subStatus: "SHS Confirming" },
  "Sent to Holman for research": { mainStatus: "Confirming Status", subStatus: "Holman Confirming" },
  "Location to be Determined": { mainStatus: "Confirming Status", subStatus: "Location Unknown" },
  "Need to call tech": { mainStatus: "Confirming Status", subStatus: "Awaiting Tech Response" },
  // Location unknown with declined estimate - still confirming location but we know repair was declined
  "Location unknown, declined estimate, not yet sold": { mainStatus: "Confirming Status", subStatus: "Declined Repair" },
  "Location unknown, declined estimate": { mainStatus: "Confirming Status", subStatus: "Declined Repair" },
  "Location unconfirmed, declined estimate, not yet sold": { mainStatus: "Confirming Status", subStatus: "Declined Repair" },
  "Location unconfirmed, declined estimate": { mainStatus: "Confirming Status", subStatus: "Declined Repair" },
  
  // Decision Pending mappings (location IS confirmed)
  "Location confirmed, didn't make decision on the estimate": { mainStatus: "Decision Pending", subStatus: "Estimate received, needs review" },
  // Location unconfirmed with pending decision - still confirming location
  "Location to be Determined, didn't make decision on the estimate": { mainStatus: "Confirming Status", subStatus: "Estimate Pending Decision" },
  "Location unconfirmed, didn't make decision on the estimate": { mainStatus: "Confirming Status", subStatus: "Estimate Pending Decision" },
  "Location unknown, didn't make decision on the estimate": { mainStatus: "Confirming Status", subStatus: "Estimate Pending Decision" },
  
  // Repairing mappings
  "Location confirmed, approved estimate, vehicle still in shop": { mainStatus: "Repairing", subStatus: "Under repair at shop" },
  "Location confirmed, Waiting on repair": { mainStatus: "Repairing", subStatus: "Waiting on repair completion" },
  
  // Declined Repair mappings (location IS confirmed)
  "Location confirmed, declined estimate, not yet sold": { mainStatus: "Declined Repair", subStatus: "Vehicle submitted for sale" },
  "Location confirmed, declined estimate": { mainStatus: "Declined Repair", subStatus: "Vehicle submitted for sale" },
  "Vehicle was sold": { mainStatus: "Declined Repair", subStatus: "Vehicle was sold" },
  
  // Tags mappings
  "Location confirmed, needs tag": { mainStatus: "Tags", subStatus: "Needs tag/registration" },
  
  // Scheduling mappings
  "Location confirmed, waiting on tech pickup": { mainStatus: "Scheduling", subStatus: "Scheduled, awaiting tech pickup" },
  
  // PMF mappings
  "Sent to Park My Fleet": { mainStatus: "PMF", subStatus: "In transit to PMF" },
  
  // In Transit mappings
  "Need transport to new tech": { mainStatus: "In Transit", subStatus: "Being transported to technician" },
  
  // On Road mappings
  "Tech Picked Up": { mainStatus: "On Road", subStatus: "Delivered to technician" },
  
  // Location confirmed without sub-status defaults to Decision Pending
  "Location confirmed": { mainStatus: "Decision Pending", subStatus: "Awaiting estimate from shop" },
};

// Reverse mapping: sub-status to original CSV values (for tooltip display)
export const SUB_STATUS_TO_CSV_VALUES: Record<string, string[]> = {
  "SHS Confirming": ["Research required"],
  "Holman Confirming": ["Sent to Holman for research"],
  "Location Unknown": ["Location to be Determined"],
  "Awaiting Tech Response": ["Need to call tech"],
  "Declined Repair": [
    "Location unknown, declined estimate, not yet sold",
    "Location unknown, declined estimate",
    "Location unconfirmed, declined estimate, not yet sold",
    "Location unconfirmed, declined estimate"
  ],
  "Estimate Pending Decision": [
    "Location to be Determined, didn't make decision on the estimate",
    "Location unconfirmed, didn't make decision on the estimate",
    "Location unknown, didn't make decision on the estimate"
  ],
  "Awaiting estimate from shop": ["Location confirmed"],
  "Estimate received, needs review": ["Location confirmed, didn't make decision on the estimate"],
  "Under repair at shop": ["Location confirmed, approved estimate, vehicle still in shop"],
  "Waiting on repair completion": ["Location confirmed, Waiting on repair", "Location confirmed, waiting on repair completion"],
  "Vehicle submitted for sale": [
    "Location confirmed, declined estimate, not yet sold",
    "Location confirmed, declined estimate"
  ],
  "Vehicle was sold": ["Vehicle was sold"],
  "Needs tag/registration": ["Location confirmed, needs tag"],
  "Scheduled, awaiting tech pickup": ["Location confirmed, waiting on tech pickup"],
  "In transit to PMF": ["Sent to Park My Fleet"],
  "Being transported to technician": ["Need transport to new tech", "Needs transporting to new technician"],
  "Delivered to technician": ["Tech Picked Up"],
};

// Get original CSV value(s) for a sub-status
export function getOriginalCSVValue(subStatus: string | null): string | null {
  if (!subStatus) return null;
  const csvValues = SUB_STATUS_TO_CSV_VALUES[subStatus];
  if (!csvValues || csvValues.length === 0) return null;
  return csvValues.join(" | ");
}

// Map CSV sub-status text to new normalized sub-status names
const subStatusMapping: Record<string, string> = {
  // Tags variations
  "needs tag": "Needs tag/registration",
  "need tags": "Needs tag/registration",
  "need tag": "Needs tag/registration",
  // Approved estimate variations -> Under repair
  "approved estimate, vehicle still in shop": "Under repair at shop",
  "approved estimate": "Under repair at shop",
  // Declined estimate variations -> Vehicle submitted for sale
  "declined estimate, not yet sold": "Vehicle submitted for sale",
  "declined estimate": "Vehicle submitted for sale",
  // Decision variations -> Estimate received, needs review
  "didn't make decision on the estimate": "Estimate received, needs review",
  "didn't make decision": "Estimate received, needs review",
  "didnt make decision on the estimate": "Estimate received, needs review",
  "didnt make decision": "Estimate received, needs review",
  // Waiting on tech pickup -> Scheduled
  "waiting on tech pickup": "Scheduled, awaiting tech pickup",
  "waiting on repair completion": "Waiting on repair completion",
  "waiting on repair": "Waiting on repair completion",
};

// Map alternate main status names to our canonical names
const mainStatusMapping: Record<string, MainStatus> = {
  // Old statuses to new categories
  "research required": "Confirming Status",
  "location unknown": "Confirming Status",
  "location unconfirmed": "Confirming Status",
  "location to be determined": "Confirming Status",
  "need to call tech": "Confirming Status",
  "sent to holman for research": "Confirming Status",
  "location confirmed": "Decision Pending",
  "needs transporting to new technician": "In Transit",
  "need transport to new tech": "In Transit",
  "tech picked up": "On Road",
  "sent to park my fleet": "PMF",
  "vehicle was sold": "Declined Repair",
};

// Special combined status patterns that need custom parsing
const specialStatusPatterns: Array<{ pattern: string; mainStatus: MainStatus; subStatus: string | null }> = [
  { pattern: "sent to holman for research", mainStatus: "Confirming Status", subStatus: "Holman Confirming" },
  { pattern: "research required – sent to holman", mainStatus: "Confirming Status", subStatus: "Holman Confirming" },
  { pattern: "research required - sent to holman", mainStatus: "Confirming Status", subStatus: "Holman Confirming" },
  { pattern: "research required, sent to holman", mainStatus: "Confirming Status", subStatus: "Holman Confirming" },
  { pattern: "tech picked up", mainStatus: "On Road", subStatus: "Delivered to technician" },
  { pattern: "vehicle was sold", mainStatus: "Declined Repair", subStatus: "Vehicle was sold" },
  { pattern: "sent to park my fleet", mainStatus: "PMF", subStatus: "In transit to PMF" },
];

// Helper to parse combined status into main + sub
export function parseStatus(combinedStatus: string): { mainStatus: MainStatus; subStatus: string | null } {
  if (!combinedStatus || combinedStatus.trim() === "") {
    return { mainStatus: "Confirming Status", subStatus: "SHS Confirming" };
  }
  
  const normalized = combinedStatus.trim();
  const lowerNormalized = normalized.toLowerCase();
  
  // Check for special patterns first
  for (const special of specialStatusPatterns) {
    if (lowerNormalized === special.pattern || lowerNormalized.startsWith(special.pattern)) {
      return { mainStatus: special.mainStatus, subStatus: special.subStatus };
    }
  }
  
  // Check for mapped main statuses (like "Location unknown" -> "Location to be Determined")
  for (const [altName, canonicalName] of Object.entries(mainStatusMapping)) {
    if (lowerNormalized === altName) {
      return { mainStatus: canonicalName, subStatus: null };
    }
    // Check with sub-status separator
    if (lowerNormalized.startsWith(altName + ", ")) {
      const sub = normalized.substring(altName.length + 2).trim();
      const mappedSub = subStatusMapping[sub.toLowerCase()] || sub;
      return { mainStatus: canonicalName, subStatus: mappedSub };
    }
  }
  
  // Check each main status to find a match
  for (const main of MAIN_STATUSES) {
    // Exact match
    if (normalized === main || lowerNormalized === main.toLowerCase()) {
      return { mainStatus: main, subStatus: null };
    }
    
    // Check for " – " separator (our format)
    if (normalized.startsWith(main + " – ")) {
      const sub = normalized.substring(main.length + 3).trim();
      const mappedSub = subStatusMapping[sub.toLowerCase()] || sub;
      return { mainStatus: main, subStatus: mappedSub };
    }
    
    // Check for ", " separator (CSV format like "Location confirmed, needs tag")
    if (lowerNormalized.startsWith(main.toLowerCase() + ", ")) {
      const sub = normalized.substring(main.length + 2).trim();
      const mappedSub = subStatusMapping[sub.toLowerCase()] || sub;
      return { mainStatus: main, subStatus: mappedSub };
    }
    
    // Check for " - " separator (dash variant)
    if (normalized.startsWith(main + " - ")) {
      const sub = normalized.substring(main.length + 3).trim();
      const mappedSub = subStatusMapping[sub.toLowerCase()] || sub;
      return { mainStatus: main, subStatus: mappedSub };
    }
  }
  
  // Fallback - default to Confirming Status
  return { mainStatus: "Confirming Status", subStatus: "SHS Confirming" };
}

// Validate mainStatus is a valid MainStatus
export function isValidMainStatus(status: string): status is MainStatus {
  return MAIN_STATUSES.includes(status as MainStatus);
}

// Validate subStatus is valid for a given mainStatus
export function isValidSubStatus(mainStatus: MainStatus, subStatus: string | null): boolean {
  if (subStatus === null || subStatus === "") return true;
  const validSubs = SUB_STATUSES[mainStatus];
  return validSubs.includes(subStatus);
}

// Validate status strictly - throws error for invalid values
export function validateStatus(mainStatus: string | null | undefined, subStatus: string | null | undefined): { mainStatus: MainStatus; subStatus: string | null } {
  // mainStatus is required
  if (!mainStatus) {
    throw new Error("Main status is required");
  }
  
  if (!isValidMainStatus(mainStatus)) {
    throw new Error(`Invalid main status: "${mainStatus}". Valid options: ${MAIN_STATUSES.join(", ")}`);
  }
  
  // Validate subStatus for the mainStatus if provided
  const normalizedSub = subStatus || null;
  if (normalizedSub && !isValidSubStatus(mainStatus, normalizedSub)) {
    const validSubs = SUB_STATUSES[mainStatus];
    if (validSubs.length === 0) {
      throw new Error(`Main status "${mainStatus}" does not support sub-statuses, but got: "${normalizedSub}"`);
    }
    throw new Error(`Invalid sub-status "${normalizedSub}" for main status "${mainStatus}". Valid options: ${validSubs.join(", ")}`);
  }
  
  return { mainStatus, subStatus: normalizedSub };
}

// Normalize status with fallbacks (for legacy data migration, not strict validation)
export function normalizeStatusLegacy(mainStatus: string | null | undefined, subStatus: string | null | undefined): { mainStatus: MainStatus; subStatus: string | null } {
  // Default to "Confirming Status" if no mainStatus
  if (!mainStatus || !isValidMainStatus(mainStatus)) {
    return { mainStatus: "Confirming Status", subStatus: "SHS Confirming" };
  }
  
  // Validate subStatus for the mainStatus
  const normalizedSub = subStatus || null;
  if (normalizedSub && !isValidSubStatus(mainStatus, normalizedSub)) {
    return { mainStatus, subStatus: null };
  }
  
  return { mainStatus, subStatus: normalizedSub };
}

// Combined statuses - all 25 sub-statuses with their categories
export const TRUCK_STATUSES = [
  // Confirming Status
  "Confirming Status, SHS Confirming",
  "Confirming Status, Holman Confirming",
  "Confirming Status, Location Unknown",
  "Confirming Status, Awaiting Tech Response",
  "Confirming Status, Declined Repair",
  "Confirming Status, Estimate Pending Decision",
  // Decision Pending
  "Decision Pending, Awaiting estimate from shop",
  "Decision Pending, Estimate received, needs review",
  "Decision Pending, Repair approved",
  "Decision Pending, Repair declined",
  // Repairing
  "Repairing, Under repair at shop",
  "Repairing, Waiting on repair completion",
  // Declined Repair
  "Declined Repair, Vehicle in process of being decommissioned",
  "Declined Repair, Vehicle submitted for sale",
  "Declined Repair, Vehicle was sold",
  // Tags
  "Tags, Needs tag/registration",
  "Tags, Registration renewal in progress",
  "Tags, Tags/registration complete",
  // Scheduling
  "Scheduling, To be scheduled for tech pickup",
  "Scheduling, Scheduled, awaiting tech pickup",
  // PMF
  "PMF, In transit to PMF",
  "PMF, Undergoing work at PMF",
  "PMF, Ready for redeployment",
  // In Transit
  "In Transit, Being transported to technician",
  // On Road
  "On Road, Delivered to technician",
  "On Road, Other tech swiped van"
] as const;

export type TruckStatus = typeof TRUCK_STATUSES[number];

export const trucks = pgTable("fs_trucks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  truckNumber: text("truck_number").notNull().unique(),
  status: text("status").notNull(), // Combined status for display
  mainStatus: text("main_status"), // Main category
  subStatus: text("sub_status"), // Sub-category (optional)
  
  // SHS Owner
  shsOwner: text("shs_owner"),
  dateLastMarkedAsOwned: text("date_last_marked_as_owned"),
  
  // Van Status
  registrationStickerValid: text("registration_sticker_valid"), // Yes, Expired, Shop would not check, or null
  registrationExpiryDate: text("registration_expiry_date"), // "Have Tags" column - date when tags were received
  registrationLastUpdate: text("registration_last_update"), // Date when Reg. Sticker Valid was last updated
  registrationInProgress: boolean("registration_in_progress").default(false), // Registration in process (Cheryl mailed to tech)
  holmanRegExpiry: text("holman_reg_expiry"),
  holmanVehicleRef: text("holman_vehicle_ref"),
  repairOrSaleDecision: text("repair_or_sale_decision"),
  
  // Sales Status
  vanInventoried: boolean("van_inventoried").default(false),
  salePrice: text("sale_price"),
  datePutForSale: text("date_put_for_sale"),
  dateSold: text("date_sold"),
  
  // Repair Status
  datePutInRepair: text("date_put_in_repair"),
  billPaidDate: text("bill_paid_date"), // Latest bill paid date from Fleet Finance data
  repairCompleted: boolean("repair_completed").default(false),
  inAms: boolean("in_ams").default(false), // AMS Documented
  repairAddress: text("repair_address"),
  repairPhone: text("repair_phone"),
  contactName: text("contact_name"), // Local Repair Contact Name
  confirmedSetOfExpiredTags: boolean("confirmed_set_of_expired_tags").default(false),
  confirmedDeclinedRepair: text("confirmed_declined_repair"),
  
  // Registration & Tags Workflow - Expired Tags Path
  tagsInOffice: boolean("tags_in_office").default(false), // John/Cheryl has tags ready
  tagsSentToTech: boolean("tags_sent_to_tech").default(false), // Tags mailed/delivered to tech
  renewalProcessStarted: boolean("renewal_process_started").default(false), // John/Cheryl started the process
  awaitingTechDocuments: boolean("awaiting_tech_documents").default(false), // Waiting for tech to send inspection docs
  documentsSentToHolman: boolean("documents_sent_to_holman").default(false), // Docs submitted to Holman
  holmanProcessingComplete: boolean("holman_processing_complete").default(false), // Holman finished processing
  
  // Registration & Tags Workflow - Vehicle Inspection Path
  inspectionLocation: text("inspection_location"), // Where tech should bring van for inspection
  vanBroughtForInspection: boolean("van_brought_for_inspection").default(false), // Tech brought van in
  inspectionComplete: boolean("inspection_complete").default(false), // Inspection/certification done
  
  // Snowflake TPMS Assignment Status
  snowflakeAssigned: boolean("snowflake_assigned"), // Y if found in Snowflake TPMS_EXTRACT, N if not
  
  // Offboarding match — set true when tech name matched weekly offboarding roster; never cleared by sync
  offboardingFlagged: boolean("offboarding_flagged").default(false),
  
  // Pick Up Information
  techName: text("tech_name"),
  techPhone: text("tech_phone"),
  techLeadName: text("tech_lead_name"), // Manager name from TPMS_EXTRACT MANAGER_NAME column
  techLeadPhone: text("tech_lead_phone"), // Manager phone from TPMS_EXTRACT (looked up via MANAGER_ENT_ID -> ENTERPRISE_ID)
  techState: text("tech_state"), // 2-letter state code from Snowflake PRIMARY_STATE or AMS_CUR_STATE fallback
  techStateSource: text("tech_state_source"), // Source of techState: "TPMS" or "AMS"
  pickUpSlotBooked: boolean("pick_up_slot_booked").default(false),
  timeBlockedToPickUpVan: text("time_blocked_to_pick_up_van"),
  regTestSlotBooked: boolean("reg_test_slot_booked").default(false),
  regTestSlotDetails: text("reg_test_slot_details"),
  rentalReturned: boolean("rental_returned").default(false),
  vanPickedUp: boolean("van_picked_up").default(false),
  
  // Comments
  comments: text("comments"),
  notes: text("notes"),
  virtualComments: text("virtual_comments"),
  
  // Gave Holman tracking
  gaveHolman: text("gave_holman"), // Yes or No
  gaveHolmanUpdatedAt: timestamp("gave_holman_updated_at"), // When Gave Holman was last changed
  lastDateCalled: text("last_date_called"), // Last date the shop/vendor was called
  callStatus: text("call_status"), // Brief call status note (max 50 chars)
  eta: text("eta"), // Estimated time of arrival date
  
  // Rental tracking fields
  // Renter per the Rental Ops report (Enterprise RENTER_NAME / Holman first+last),
  // written by every rental sync. renter_name_manual marks a human-entered value
  // the sync must never clobber. Distinct from techName (TPMS assignment).
  renterName: text("renter_name"),
  renterNameManual: boolean("renter_name_manual").default(false),
  rentalStartDate: text("rental_start_date"),
  expectedReturnDate: text("expected_return_date"),
  rentalStatus: text("rental_status"),
  rentalReason: text("rental_reason"),
  associatedVehicleId: text("associated_vehicle_id"),
  rentalNotes: text("rental_notes"),
  
  // Registration process tracking fields
  processOwner: text("process_owner"),
  currentRenewalStep: text("current_renewal_step"),
  
  // Repair tracking fields
  repairPriority: text("repair_priority"),
  expectedCompletion: text("expected_completion"),
  estimatedCost: text("estimated_cost"),
  actualCost: text("actual_cost"),
  readyForPickup: boolean("ready_for_pickup").default(false),
  dateReturnedToService: text("date_returned_to_service"),
  
  // Legacy/Other fields
  newTruckAssigned: boolean("new_truck_assigned").default(false),
  registrationRenewalInProcess: boolean("registration_renewal_in_process").default(false),
  spareVanAssignmentInProcess: boolean("spare_van_assignment_in_process").default(false),
  spareVanInProcessToShip: boolean("spare_van_in_process_to_ship").default(false),
  
  // Call tracking (ElevenLabs outbound calls - repair shop)
  lastCallDate: timestamp("last_call_date"),
  lastCallSummary: text("last_call_summary"),
  lastCallStatus: text("last_call_status"),
  lastCallConversationId: text("last_call_conversation_id"),

  // Call tracking (ElevenLabs outbound calls - technician pickup)
  lastTechCallDate: timestamp("last_tech_call_date"),
  lastTechCallSummary: text("last_tech_call_summary"),
  lastTechCallStatus: text("last_tech_call_status"),
  lastTechCallConversationId: text("last_tech_call_conversation_id"),

  // Shop List sync fields (from Rental Extension Review)
  enterpriseId: text("enterprise_id"), // Enterprise ID from Shop List column D

  // Status change tracking — set whenever mainStatus is updated
  mainStatusChangedAt: timestamp("main_status_changed_at"),

  // Vehicle identity (populated from Holman/Snowflake at call time)
  vin: varchar("vin", { length: 20 }), // Vehicle VIN
  licensePlate: varchar("license_plate", { length: 30 }), // License plate from Holman

  // Timestamps
  lastUpdatedAt: timestamp("last_updated_at").default(sql`now()`),
  lastUpdatedBy: text("last_updated_by").default("System"),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const actions = pgTable("fs_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  truckId: varchar("truck_id").notNull().references(() => trucks.id, { onDelete: "cascade" }),
  actionTime: timestamp("action_time").default(sql`now()`),
  actionBy: text("action_by").notNull().default("System"),
  actionType: text("action_type").notNull(),
  actionNote: text("action_note"),
});

export const TRACKING_CARRIERS = ["UPS", "FedEx", "USPS"] as const;
export type TrackingCarrier = typeof TRACKING_CARRIERS[number];

export const trackingRecords = pgTable("fs_tracking_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  truckId: varchar("truck_id").references(() => trucks.id, { onDelete: "cascade" }),
  carrier: text("carrier").notNull().default("UPS"),
  trackingNumber: text("tracking_number").notNull(),
  description: text("description"),
  
  lastStatus: text("last_status"),
  lastStatusDescription: text("last_status_description"),
  lastLocation: text("last_location"),
  estimatedDelivery: text("estimated_delivery"),
  deliveredAt: timestamp("delivered_at"),
  
  lastCheckedAt: timestamp("last_checked_at"),
  lastError: text("last_error"),
  errorAt: timestamp("error_at"),
  
  createdAt: timestamp("created_at").default(sql`now()`),
  createdBy: text("created_by").default("System"),
});

// Weekly snapshot of "Active" vehicle count from AMS, captured on read.
// One row per Monday (week start, ISO YYYY-MM-DD).
export const amsActiveWeeklySnapshots = pgTable("fs_ams_active_weekly_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  weekStart: text("week_start").notNull().unique(), // YYYY-MM-DD (Monday)
  activeCount: integer("active_count").notNull().default(0),
  capturedAt: timestamp("captured_at").default(sql`now()`),
});
export type AmsActiveWeeklySnapshot = typeof amsActiveWeeklySnapshots.$inferSelect;

// Weekly snapshot of Samsara penetration counts across the AMS fleet.
// Captured on read; one row per Monday week-start (ISO YYYY-MM-DD).
export const samsaraPenetrationWeeklySnapshots = pgTable(
  "fs_samsara_penetration_weekly_snapshots",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    weekStart: text("week_start").notNull().unique(), // YYYY-MM-DD (Monday)
    activeCount: integer("active_count").notNull().default(0),
    inactiveCount: integer("inactive_count").notNull().default(0),
    unpluggedCount: integer("unplugged_count").notNull().default(0),
    notInstalledCount: integer("not_installed_count").notNull().default(0),
    totalCount: integer("total_count").notNull().default(0),
    capturedAt: timestamp("captured_at").default(sql`now()`),
  },
);
export type SamsaraPenetrationWeeklySnapshot =
  typeof samsaraPenetrationWeeklySnapshots.$inferSelect;

// Metrics snapshots table for daily tracking
export const metricsSnapshots = pgTable("fs_metrics_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  metricDate: text("metric_date").notNull().unique(), // YYYY-MM-DD format
  
  // Truck counts by status
  trucksOnRoad: integer("trucks_on_road").notNull().default(0),
  trucksScheduled: integer("trucks_scheduled").notNull().default(0),
  
  // Registration sticker counts
  regContactedTech: integer("reg_contacted_tech").notNull().default(0),
  regMailedTag: integer("reg_mailed_tag").notNull().default(0),
  regOrderedDuplicates: integer("reg_ordered_duplicates").notNull().default(0),
  
  // Additional useful metrics
  totalTrucks: integer("total_trucks").notNull().default(0),
  trucksRepairing: integer("trucks_repairing").notNull().default(0),
  trucksConfirmingStatus: integer("trucks_confirming_status").notNull().default(0),
  
  capturedAt: timestamp("captured_at").default(sql`now()`),
  capturedBy: text("captured_by").default("System"),
});

// Preprocessor to normalize empty strings to null
const normalizeEmptyToNull = z.preprocess(
  (val) => (typeof val === "string" && val.trim() === "" ? null : val),
  z.string().nullable().optional()
);

const baseInsertSchema = createInsertSchema(trucks, {
  mainStatus: z.enum(MAIN_STATUSES),
  subStatus: normalizeEmptyToNull,
  truckNumber: z.string().min(1, "Truck number is required"),
  datePutInRepair: normalizeEmptyToNull,
  inspectionLocation: normalizeEmptyToNull,
}).omit({
  id: true,
  createdAt: true,
  lastUpdatedAt: true,
  status: true,
});

export const insertTruckSchema = baseInsertSchema.superRefine((data, ctx) => {
  const mainStatus = data.mainStatus as MainStatus;
  const subStatus = data.subStatus;
  
  if (subStatus && subStatus.trim() !== "") {
    const validSubs = SUB_STATUSES[mainStatus];
    if (validSubs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subStatus"],
        message: `Main status "${mainStatus}" does not support sub-statuses`,
      });
    } else if (!validSubs.includes(subStatus)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subStatus"],
        message: `Invalid sub-status "${subStatus}" for main status "${mainStatus}". Valid options: ${validSubs.join(", ")}`,
      });
    }
  }
});

const baseUpdateSchema = createInsertSchema(trucks, {
  mainStatus: z.enum(MAIN_STATUSES).optional(),
  subStatus: normalizeEmptyToNull,
  truckNumber: z.string().min(1).optional(),
  datePutInRepair: normalizeEmptyToNull,
  registrationExpiryDate: normalizeEmptyToNull,
  inspectionLocation: normalizeEmptyToNull,
}).omit({
  id: true,
  createdAt: true,
  lastUpdatedAt: true,
  status: true,
}).partial().extend({
  lastUpdatedBy: z.string().min(1, "Updated by is required").default("User"),
});

export const updateTruckSchema = baseUpdateSchema.superRefine((data, ctx) => {
  // If subStatus is provided, mainStatus must also be provided for validation
  if (data.subStatus && data.subStatus.trim() !== "" && !data.mainStatus) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["mainStatus"],
      message: "Main status is required when updating sub-status",
    });
    return;
  }
  
  if (data.mainStatus && data.subStatus && data.subStatus.trim() !== "") {
    const mainStatus = data.mainStatus as MainStatus;
    const validSubs = SUB_STATUSES[mainStatus];
    if (validSubs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subStatus"],
        message: `Main status "${mainStatus}" does not support sub-statuses`,
      });
    } else if (!validSubs.includes(data.subStatus)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subStatus"],
        message: `Invalid sub-status "${data.subStatus}" for main status "${mainStatus}". Valid options: ${validSubs.join(", ")}`,
      });
    }
  }
});

export const insertActionSchema = createInsertSchema(actions).omit({
  id: true,
});

export const insertTrackingRecordSchema = createInsertSchema(trackingRecords, {
  carrier: z.enum(TRACKING_CARRIERS).default("UPS"),
  trackingNumber: z.string().min(1, "Tracking number is required"),
}).omit({
  id: true,
  createdAt: true,
  lastCheckedAt: true,
  lastError: true,
  errorAt: true,
});

export type InsertTruck = z.infer<typeof insertTruckSchema>;
export type UpdateTruck = z.infer<typeof updateTruckSchema>;
export type Truck = typeof trucks.$inferSelect;
export type Action = typeof actions.$inferSelect;
export type InsertAction = z.infer<typeof insertActionSchema>;
export type TrackingRecord = typeof trackingRecords.$inferSelect;
export type InsertTrackingRecord = z.infer<typeof insertTrackingRecordSchema>;

// PMF (Park My Fleet) Data Persistence Tables
export const pmfImports = pgTable("fs_pmf_imports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  originalFilename: text("original_filename"),
  headers: text("headers"), // JSON stringified array of headers
  activityHeaders: text("activity_headers"), // JSON stringified { action, activity, activityDate }
  importedAt: timestamp("imported_at").default(sql`now()`),
  importedBy: text("imported_by").default("System"),
  rowCount: integer("row_count").default(0),
});

export const pmfRows = pgTable("fs_pmf_rows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  importId: varchar("import_id").references(() => pmfImports.id, { onDelete: "set null" }),
  assetId: text("asset_id").unique(), // Unique constraint for upsert by assetId
  status: text("status"),
  rawRow: text("raw_row"), // JSON stringified row data
  createdAt: timestamp("created_at").default(sql`now()`), // When first imported
  updatedAt: timestamp("updated_at").default(sql`now()`), // When last updated
});

export const insertPmfImportSchema = createInsertSchema(pmfImports).omit({
  id: true,
  importedAt: true,
});

export const insertPmfRowSchema = createInsertSchema(pmfRows).omit({
  id: true,
  createdAt: true,
});

export type PmfImport = typeof pmfImports.$inferSelect;
export type InsertPmfImport = z.infer<typeof insertPmfImportSchema>;
export type PmfRow = typeof pmfRows.$inferSelect;
export type InsertPmfRow = z.infer<typeof insertPmfRowSchema>;

// PMF Status Change Events - tracks when vehicles change status
export const pmfStatusEvents = pgTable("fs_pmf_status_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  assetId: text("asset_id").notNull(),
  status: text("status").notNull(),
  previousStatus: text("previous_status"),
  effectiveAt: timestamp("effective_at").notNull().default(sql`now()`),
  source: text("source").default("import"), // 'import', 'sync', 'manual'
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const insertPmfStatusEventSchema = createInsertSchema(pmfStatusEvents).omit({
  id: true,
  createdAt: true,
});

export type PmfStatusEvent = typeof pmfStatusEvents.$inferSelect;
export type InsertPmfStatusEvent = z.infer<typeof insertPmfStatusEventSchema>;

// Fleet Scope Truck Status Events - tracks every mainStatus change for fleet scope trucks.
// Analogous to fs_pmf_status_events for PMF/PARQ vehicles. Used to compute daysInStatus.
export const truckStatusEvents = pgTable("fs_truck_status_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  truckId: varchar("truck_id").notNull().references(() => trucks.id, { onDelete: "cascade" }),
  mainStatus: text("main_status").notNull(),
  previousStatus: text("previous_status"),
  effectiveAt: timestamp("effective_at").notNull().default(sql`now()`),
  source: text("source").default("system"), // 'system', 'manual', 'import'
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const insertTruckStatusEventSchema = createInsertSchema(truckStatusEvents).omit({
  id: true,
  createdAt: true,
});

export type TruckStatusEvent = typeof truckStatusEvents.$inferSelect;
export type InsertTruckStatusEvent = z.infer<typeof insertTruckStatusEventSchema>;

// PMF Activity Logs - tracks vehicle activity from PARQ API (synced every 6 hours)
export const pmfActivityLogs = pgTable("fs_pmf_activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vehicleId: integer("vehicle_id").notNull(), // PARQ vehicle ID (numeric)
  assetId: text("asset_id").notNull(), // Asset ID for linking to pmf_rows
  activityDate: timestamp("activity_date").notNull(), // Date from PARQ API
  action: text("action").notNull(), // Action description
  activityType: integer("activity_type").notNull(), // 1 = Work Order, 2 = Vehicle Status Change
  typeDescription: text("type_description").notNull(), // "Work Order" or "Vehicle Status Change"
  workOrderId: integer("work_order_id"), // Optional work order ID
  createdAt: timestamp("created_at").default(sql`now()`),
});

// PMF Activity Sync Metadata - tracks last sync time
export const pmfActivitySyncMeta = pgTable("fs_pmf_activity_sync_meta", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  lastSyncAt: timestamp("last_sync_at").default(sql`now()`),
  vehiclesSynced: integer("vehicles_synced").default(0),
  logsFetched: integer("logs_fetched").default(0),
  syncStatus: text("sync_status").default("success"), // 'success', 'partial', 'failed'
  errorMessage: text("error_message"),
});

export const insertPmfActivityLogSchema = createInsertSchema(pmfActivityLogs).omit({
  id: true,
  createdAt: true,
});

export const insertPmfActivitySyncMetaSchema = createInsertSchema(pmfActivitySyncMeta).omit({
  id: true,
});

export type PmfActivityLog = typeof pmfActivityLogs.$inferSelect;
export type InsertPmfActivityLog = z.infer<typeof insertPmfActivityLogSchema>;
export type PmfActivitySyncMeta = typeof pmfActivitySyncMeta.$inferSelect;
export type InsertPmfActivitySyncMeta = z.infer<typeof insertPmfActivitySyncMetaSchema>;

// Metrics snapshot types
export const insertMetricsSnapshotSchema = createInsertSchema(metricsSnapshots).omit({
  id: true,
  capturedAt: true,
});

export type MetricsSnapshot = typeof metricsSnapshots.$inferSelect;
export type InsertMetricsSnapshot = z.infer<typeof insertMetricsSnapshotSchema>;

// Spare Vehicle Details - editable fields for vehicles from Snowflake UNASSIGNED_VEHICLES
export const spareVehicleDetails = pgTable("fs_spare_vehicle_details", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vehicleNumber: varchar("vehicle_number", { length: 50 }).notNull().unique(), // Links to Snowflake VEHICLE_NUMBER
  keysStatus: varchar("keys_status", { length: 50 }), // Present / Not Present / Unknown/would not check
  registrationRenewalDate: timestamp("registration_renewal_date"), // Identified Replacement Vans Registration Renewal Date
  repairCompleted: varchar("repair_completed", { length: 50 }), // Complete / In Process / Unknown if needed / Declined
  physicalAddress: text("physical_address"), // Physical vehicle address
  contactNamePhone: text("contact_name_phone"), // Name and Contact Phone Number for van location
  generalComments: text("general_comments"), // General Comments
  johnsComments: text("johns_comments"), // John's Comments (Fleet Team Comments)
  scheduleToPmf: varchar("schedule_to_pmf", { length: 10 }), // Schedule van to move to PMF (Yes/No)
  pmfLocationAddress: text("pmf_location_address"), // What PMF Location should it go to
  enteredIntoTransportList: varchar("entered_into_transport_list", { length: 10 }), // Truck entered into Jassiel's Transport List (Yes/No)
  updatedAt: timestamp("updated_at").default(sql`now()`),
  updatedBy: text("updated_by"),
  vin: varchar("vin", { length: 20 }), // Vehicle VIN
  isManualEntry: boolean("is_manual_entry").default(false), // Whether this truck was manually added
});

export const insertSpareVehicleDetailsSchema = createInsertSchema(spareVehicleDetails).omit({
  id: true,
  updatedAt: true,
});

export const updateSpareVehicleDetailsSchema = insertSpareVehicleDetailsSchema.partial();

export type SpareVehicleDetails = typeof spareVehicleDetails.$inferSelect;
export type InsertSpareVehicleDetails = z.infer<typeof insertSpareVehicleDetailsSchema>;
export type UpdateSpareVehicleDetails = z.infer<typeof updateSpareVehicleDetailsSchema>;

// Purchase Orders (POs) Table - stores imported PO data from CSV/XLSX
// Each row from file is stored separately (no consolidation)
export const purchaseOrders = pgTable("fs_purchase_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poNumber: varchar("po_number", { length: 100 }).notNull(), // PO number used for matching during re-import
  rawData: text("raw_data"), // JSON stringified row data from import
  submittedInHolman: text("submitted_in_holman"), // Preserved separately during re-imports
  finalApproval: text("final_approval"), // Preserved separately during re-imports
  importedAt: timestamp("imported_at").default(sql`now()`),
  importedBy: text("imported_by"),
});

// PO import metadata - tracks column headers from imports
export const poImportMeta = pgTable("fs_po_import_meta", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  headers: text("headers"), // JSON stringified array of column headers
  lastImportedAt: timestamp("last_imported_at").default(sql`now()`),
  lastImportedBy: text("last_imported_by"),
  totalRows: integer("total_rows").default(0),
});

// Audit log of Final Approval changes; digested_at marks inclusion in the daily email digest
export const poDecisionLog = pgTable("fs_po_decision_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poId: varchar("po_id"),
  poNumber: varchar("po_number", { length: 100 }),
  vehicleNo: varchar("vehicle_no", { length: 50 }),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changedAt: timestamp("changed_at").default(sql`now()`),
  digestedAt: timestamp("digested_at"),
});

export type PoDecisionLogEntry = typeof poDecisionLog.$inferSelect;

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({
  id: true,
  importedAt: true,
});

export const insertPoImportMetaSchema = createInsertSchema(poImportMeta).omit({
  id: true,
  lastImportedAt: true,
});

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PoImportMeta = typeof poImportMeta.$inferSelect;
export type InsertPoImportMeta = z.infer<typeof insertPoImportMetaSchema>;

// Archived Trucks Table - stores trucks that were removed during rental reconciliation
export const archivedTrucks = pgTable("fs_archived_trucks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  truckNumber: text("truck_number").notNull(),
  originalTruckId: varchar("original_truck_id"), // Reference to the original truck ID before archival
  
  // Snapshot of truck data at time of archival
  status: text("status"),
  mainStatus: text("main_status"),
  subStatus: text("sub_status"),
  shsOwner: text("shs_owner"),
  techName: text("tech_name"),
  techState: text("tech_state"),
  repairAddress: text("repair_address"),
  comments: text("comments"),
  
  // Archival metadata
  archivedAt: timestamp("archived_at").default(sql`now()`),
  archivedBy: text("archived_by").default("System"),
  archiveReason: text("archive_reason").default("Rental Returned"), // e.g., "Rental Returned", "Manual Archive"
  rentalImportId: varchar("rental_import_id"), // Links to the import that triggered this archival
});

// Rental Imports Table - tracks each rental list import for reconciliation
export const rentalImports = pgTable("fs_rental_imports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  importedAt: timestamp("imported_at").default(sql`now()`),
  importedBy: text("imported_by").default("System"),
  
  // Import stats
  totalInList: integer("total_in_list").notNull().default(0), // Total trucks in imported list
  newRentalsAdded: integer("new_rentals_added").notNull().default(0), // Trucks added (not in dashboard)
  rentalsReturned: integer("rentals_returned").notNull().default(0), // Trucks archived (not in list)
  existingMatched: integer("existing_matched").notNull().default(0), // Trucks that matched (no change)
  
  // For metrics tracking by week
  weekNumber: integer("week_number"), // ISO week number
  weekYear: integer("week_year"), // Year for the week
  
  // Raw data for reference
  truckNumbersImported: text("truck_numbers_imported"), // JSON array of truck numbers in this import
});

export const insertArchivedTruckSchema = createInsertSchema(archivedTrucks).omit({
  id: true,
  archivedAt: true,
});

export const insertRentalImportSchema = createInsertSchema(rentalImports).omit({
  id: true,
  importedAt: true,
});

export type ArchivedTruck = typeof archivedTrucks.$inferSelect;
export type InsertArchivedTruck = z.infer<typeof insertArchivedTruckSchema>;
export type RentalImport = typeof rentalImports.$inferSelect;
export type InsertRentalImport = z.infer<typeof insertRentalImportSchema>;

// Registration Tracking - tracks per-vehicle registration workflow fields
export const registrationTracking = pgTable("fs_registration_tracking", {
  truckNumber: text("truck_number").primaryKey(),
  initialTextSent: boolean("initial_text_sent").default(false),
  timeSlotConfirmed: boolean("time_slot_confirmed").default(false),
  timeSlotValue: text("time_slot_value"), // MM/DD-HH format
  submittedToHolman: boolean("submitted_to_holman").default(false),
  submittedToHolmanAt: timestamp("submitted_to_holman_at"),
  alreadySent: boolean("already_sent").default(false),
  comments: text("comments"), // 250 char limit enforced in UI
  updatedAt: timestamp("updated_at").default(sql`now()`),
  // Holman registration scraper fields
  lastScraped: timestamp("last_scraped"),
  scrapeStatus: text("scrape_status"), // "pending" | "scraped" | "error"
  currentStep: text("current_step"), // "New" | "Prerequisites" | "Sent to State" | "Rejected" | "Complete"
  lastChangeDate: text("last_change_date"), // Date of last change on the registration event
  etaDate: text("eta_date"), // ETA date if shown (e.g. "03/17")
  renewalDate: text("renewal_date"), // Renewal date from Holman (e.g. "03/31/2027")
  holmanStatus: text("holman_status"), // "No Active Events Found" | "No Tasks Are Available" | ""
  viewRequestBadge: text("view_request_badge"), // Badge text shown on the Holman view request
  holmanCaseStatus: text("holman_case_status"),
  holmanPendingTasks: text("holman_pending_tasks"),
  holmanEta: text("holman_eta"),
  holmanReceivedTags: boolean("holman_received_tags"),
  unassignedAddress: text("unassigned_address"),
  unassignedContactNo: text("unassigned_contact_no"),
  unassignedKeys: text("unassigned_keys"),
  unassignedComments: text("unassigned_comments"),
  unassignedAvailablePickup: text("unassigned_available_pickup"),
  nearestLdap: text("nearest_ldap"),
  nearestTechName: text("nearest_tech_name"),
  nearestTechPhone: text("nearest_tech_phone"),
  nearestTechAddress: text("nearest_tech_address"),
  nearestTechLead: text("nearest_tech_lead"),
  nearestTechLeadPhone: text("nearest_tech_lead_phone"),
});

export const insertRegistrationTrackingSchema = createInsertSchema(registrationTracking);
export type RegistrationTracking = typeof registrationTracking.$inferSelect;
export type InsertRegistrationTracking = z.infer<typeof insertRegistrationTrackingSchema>;

// Truck Consolidations - tracks weekly consolidation history
export const truckConsolidations = pgTable("fs_truck_consolidations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  consolidatedAt: timestamp("consolidated_at").default(sql`now()`),
  consolidatedBy: text("consolidated_by").default("System"),
  
  // Consolidation stats
  addedCount: integer("added_count").notNull().default(0),
  removedCount: integer("removed_count").notNull().default(0),
  unchangedCount: integer("unchanged_count").notNull().default(0),
  totalInList: integer("total_in_list").notNull().default(0),
  
  // Detailed truck lists (JSON arrays)
  addedTrucks: text("added_trucks"), // JSON array of truck numbers that were added
  removedTrucks: text("removed_trucks"), // JSON array of truck numbers that were removed
  
  // Week identification
  weekNumber: integer("week_number"),
  weekYear: integer("week_year"),
});

export const insertTruckConsolidationSchema = createInsertSchema(truckConsolidations).omit({
  id: true,
  consolidatedAt: true,
});

export type TruckConsolidation = typeof truckConsolidations.$inferSelect;
export type InsertTruckConsolidation = z.infer<typeof insertTruckConsolidationSchema>;

// BYOV Weekly Snapshots - tracks weekly enrollment counts from BYOV Dashboard
export const byovWeeklySnapshots = pgTable("fs_byov_weekly_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  capturedAt: timestamp("captured_at").default(sql`now()`),
  capturedBy: text("captured_by").default("System"),
  
  // Week identification
  weekNumber: integer("week_number").notNull(), // ISO week number
  weekYear: integer("week_year").notNull(), // Year for the week
  
  // Enrollment counts
  totalEnrolled: integer("total_enrolled").notNull().default(0),
  assignedInFleet: integer("assigned_in_fleet").notNull().default(0), // Found in REPLIT_ALL_VEHICLES with Assigned status
  notInFleet: integer("not_in_fleet").notNull().default(0), // Not found in fleet tables (personal vehicles)
  
  // Optional: breakdown by region or other metrics
  technicianIds: text("technician_ids"), // JSON array of technician IDs for reference
});

export const insertByovWeeklySnapshotSchema = createInsertSchema(byovWeeklySnapshots).omit({
  id: true,
  capturedAt: true,
});

export type ByovWeeklySnapshot = typeof byovWeeklySnapshots.$inferSelect;
export type InsertByovWeeklySnapshot = z.infer<typeof insertByovWeeklySnapshotSchema>;

// Pickup Weekly Snapshots - tracks vehicles with pickup slot booked per Sat-Fri week
export const pickupWeeklySnapshots = pgTable("fs_pickup_weekly_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  capturedAt: timestamp("captured_at").default(sql`now()`),
  capturedBy: text("captured_by").default("System"),
  weekNumber: integer("week_number").notNull(),
  weekYear: integer("week_year").notNull(),
  pickupsScheduled: integer("pickups_scheduled").notNull().default(0),
  weekLabel: text("week_label"),
  truckNumbers: text("truck_numbers").array(),
});

export const insertPickupWeeklySnapshotSchema = createInsertSchema(pickupWeeklySnapshots).omit({
  id: true,
  capturedAt: true,
});

export type PickupWeeklySnapshot = typeof pickupWeeklySnapshots.$inferSelect;
export type InsertPickupWeeklySnapshot = z.infer<typeof insertPickupWeeklySnapshotSchema>;

// Fleet Weekly Snapshots - tracks assigned/unassigned counts from REPLIT_ALL_VEHICLES
export const fleetWeeklySnapshots = pgTable("fs_fleet_weekly_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  capturedAt: timestamp("captured_at").default(sql`now()`),
  capturedBy: text("captured_by").default("System"),
  weekNumber: integer("week_number").notNull(),
  weekYear: integer("week_year").notNull(),
  totalFleet: integer("total_fleet").notNull().default(0),
  assignedCount: integer("assigned_count").notNull().default(0),
  unassignedCount: integer("unassigned_count").notNull().default(0),
  pmfCount: integer("pmf_count").notNull().default(0),
});

export const insertFleetWeeklySnapshotSchema = createInsertSchema(fleetWeeklySnapshots).omit({
  id: true,
  capturedAt: true,
});

export type FleetWeeklySnapshot = typeof fleetWeeklySnapshots.$inferSelect;
export type InsertFleetWeeklySnapshot = z.infer<typeof insertFleetWeeklySnapshotSchema>;

// PMF Status Weekly Snapshots - tracks PMF vehicle counts by status
export const pmfStatusWeeklySnapshots = pgTable("fs_pmf_status_weekly_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  capturedAt: timestamp("captured_at").default(sql`now()`),
  capturedBy: text("captured_by").default("System"),
  weekNumber: integer("week_number").notNull(),
  weekYear: integer("week_year").notNull(),
  totalPmf: integer("total_pmf").notNull().default(0),
  pendingArrival: integer("pending_arrival").notNull().default(0),
  lockedDownLocal: integer("locked_down_local").notNull().default(0),
  available: integer("available").notNull().default(0),
  pendingPickup: integer("pending_pickup").notNull().default(0),
  checkedOut: integer("checked_out").notNull().default(0),
  otherStatus: integer("other_status").notNull().default(0),
});

export const insertPmfStatusWeeklySnapshotSchema = createInsertSchema(pmfStatusWeeklySnapshots).omit({
  id: true,
  capturedAt: true,
});

export type PmfStatusWeeklySnapshot = typeof pmfStatusWeeklySnapshots.$inferSelect;
export type InsertPmfStatusWeeklySnapshot = z.infer<typeof insertPmfStatusWeeklySnapshotSchema>;

// Repair Weekly Snapshots - tracks vehicles in repair counts
export const repairWeeklySnapshots = pgTable("fs_repair_weekly_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  capturedAt: timestamp("captured_at").default(sql`now()`),
  capturedBy: text("captured_by").default("System"),
  weekNumber: integer("week_number").notNull(),
  weekYear: integer("week_year").notNull(),
  totalInRepair: integer("total_in_repair").notNull().default(0),
  activeRepairs: integer("active_repairs").notNull().default(0), // Not completed
  completedThisWeek: integer("completed_this_week").notNull().default(0),
});

export const insertRepairWeeklySnapshotSchema = createInsertSchema(repairWeeklySnapshots).omit({
  id: true,
  capturedAt: true,
});

export type RepairWeeklySnapshot = typeof repairWeeklySnapshots.$inferSelect;
export type InsertRepairWeeklySnapshot = z.infer<typeof insertRepairWeeklySnapshotSchema>;

// Fleet Cost Records - stores imported fleet cost data with upsert logic
// Matches records by identifier column (Vehicle Number, VIN, Asset ID, etc.)
export const fleetCostRecords = pgTable("fs_fleet_cost_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recordKey: varchar("record_key", { length: 255 }).notNull().unique(), // Unique identifier from the file (Vehicle Number, VIN, etc.)
  keyColumn: varchar("key_column", { length: 100 }).notNull(), // Name of the column used as identifier
  rawData: text("raw_data"), // JSON stringified row data from import
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
  importedBy: text("imported_by"),
});

// Fleet Cost Import Metadata - tracks column headers and import history
export const fleetCostImportMeta = pgTable("fs_fleet_cost_import_meta", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  headers: text("headers"), // JSON stringified array of column headers
  keyColumn: varchar("key_column", { length: 100 }), // Which column is used as identifier
  lastImportedAt: timestamp("last_imported_at").default(sql`now()`),
  lastImportedBy: text("last_imported_by"),
  totalRows: integer("total_rows").default(0),
});

export const insertFleetCostRecordSchema = createInsertSchema(fleetCostRecords).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFleetCostImportMetaSchema = createInsertSchema(fleetCostImportMeta).omit({
  id: true,
  lastImportedAt: true,
});

export type FleetCostRecord = typeof fleetCostRecords.$inferSelect;
export type InsertFleetCostRecord = z.infer<typeof insertFleetCostRecordSchema>;
export type FleetCostImportMeta = typeof fleetCostImportMeta.$inferSelect;
export type InsertFleetCostImportMeta = z.infer<typeof insertFleetCostImportMetaSchema>;

// Approved Cost Records - stores imported approved PO data (pending billing)
// Uses PO DATE for date intervals and AMOUNT column for cost values
export const approvedCostRecords = pgTable("fs_approved_cost_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recordKey: varchar("record_key", { length: 255 }).notNull().unique(), // Unique identifier from the file
  keyColumn: varchar("key_column", { length: 100 }).notNull(), // Name of the column used as identifier
  rawData: text("raw_data"), // JSON stringified row data from import
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
  importedBy: text("imported_by"),
});

// Approved Cost Import Metadata - tracks column headers and import history
export const approvedCostImportMeta = pgTable("fs_approved_cost_import_meta", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  headers: text("headers"), // JSON stringified array of column headers
  keyColumn: varchar("key_column", { length: 100 }), // Which column is used as identifier
  lastImportedAt: timestamp("last_imported_at").default(sql`now()`),
  lastImportedBy: text("last_imported_by"),
  totalRows: integer("total_rows").default(0),
});

export const insertApprovedCostRecordSchema = createInsertSchema(approvedCostRecords).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertApprovedCostImportMetaSchema = createInsertSchema(approvedCostImportMeta).omit({
  id: true,
  lastImportedAt: true,
});

export type ApprovedCostRecord = typeof approvedCostRecords.$inferSelect;
export type InsertApprovedCostRecord = z.infer<typeof insertApprovedCostRecordSchema>;
export type ApprovedCostImportMeta = typeof approvedCostImportMeta.$inferSelect;
export type InsertApprovedCostImportMeta = z.infer<typeof insertApprovedCostImportMetaSchema>;

// Samsara Locations - persists last known Samsara GPS locations for vehicles
// This ensures we retain location data even when vehicles become unassigned or stop reporting
export const samsaraLocations = pgTable("fs_samsara_locations", {
  vehicleNumber: varchar("vehicle_number", { length: 20 }).primaryKey(),
  samsaraVehicleId: varchar("samsara_vehicle_id", { length: 50 }),
  samsaraVehicleName: varchar("samsara_vehicle_name", { length: 100 }),
  latitude: text("latitude"),
  longitude: text("longitude"),
  address: text("address"),
  street: text("street"),
  city: text("city"),
  state: varchar("state", { length: 10 }),
  postal: varchar("postal", { length: 20 }),
  samsaraTimestamp: timestamp("samsara_timestamp"),
  samsaraStatus: varchar("samsara_status", { length: 50 }),
  source: varchar("source", { length: 20 }).default('api'), // 'api' or 'snowflake'
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const insertSamsaraLocationSchema = createInsertSchema(samsaraLocations).omit({
  updatedAt: true,
});

export type SamsaraLocation = typeof samsaraLocations.$inferSelect;
export type InsertSamsaraLocation = z.infer<typeof insertSamsaraLocationSchema>;

// Vehicle Maintenance Costs - stores lifetime maintenance costs per vehicle
export const vehicleMaintenanceCosts = pgTable("fs_vehicle_maintenance_costs", {
  vehicleNumber: varchar("vehicle_number", { length: 20 }).primaryKey(),
  lifetimeMaintenance: text("lifetime_maintenance"), // Stored as string to preserve formatting
  lifetimeMaintenanceNumeric: integer("lifetime_maintenance_numeric"), // Numeric value in cents for sorting
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const insertVehicleMaintenanceCostSchema = createInsertSchema(vehicleMaintenanceCosts).omit({
  updatedAt: true,
});

export type VehicleMaintenanceCost = typeof vehicleMaintenanceCosts.$inferSelect;
export type InsertVehicleMaintenanceCost = z.infer<typeof insertVehicleMaintenanceCostSchema>;

// Decommissioning Table - tracks declined repair vehicles for decommissioning
export const decommissioningVehicles = pgTable("fs_decommissioning_vehicles", {
  id: serial("id").primaryKey(),
  truckNumber: varchar("truck_number", { length: 20 }).notNull().unique(),
  vin: varchar("vin", { length: 50 }), // VIN from HOLMAN_VEHICLES table
  district: varchar("district", { length: 20 }), // District from TPMS_EXTRACT (assigned trucks) or holman_vehicles_cache (fallback)
  address: text("address"),
  zipCode: varchar("zip_code", { length: 20 }),
  phone: varchar("phone", { length: 50 }),
  comments: text("comments"),
  stillNotSold: boolean("still_not_sold").default(true),
  // Tech data from Snowflake TPMS_EXTRACT (persisted)
  enterpriseId: varchar("enterprise_id", { length: 50 }),
  fullName: varchar("full_name", { length: 100 }),
  mobilePhone: varchar("mobile_phone", { length: 50 }),
  primaryZip: varchar("primary_zip", { length: 20 }),
  managerEntId: varchar("manager_ent_id", { length: 50 }),
  managerName: varchar("manager_name", { length: 100 }),
  managerPhone: varchar("manager_phone", { length: 50 }),
  managerZip: varchar("manager_zip", { length: 20 }),
  managerDistance: integer("manager_distance"), // Distance in miles from zipCode to managerZip
  lastManagerZipForDistance: varchar("last_manager_zip_for_distance", { length: 20 }), // Track which managerZip was used
  techDistance: integer("tech_distance"), // Distance in miles from zipCode to primaryZip (Tech ZIP)
  lastTechZipForDistance: varchar("last_tech_zip_for_distance", { length: 20 }), // Track which primaryZip was used
  decomDone: boolean("decom_done").default(false), // Checkbox to mark decommissioning as complete
  sentToProcurement: boolean("sent_to_procurement").default(false), // Checkbox to mark sent to procurement
  sentToProcurementAt: timestamp("sent_to_procurement_at"), // When the checkbox was checked
  techMatchSource: varchar("tech_match_source", { length: 20 }), // 'truck' for direct match, 'zip_fallback' for ZIP-based match
  isAssigned: boolean("is_assigned").default(false), // Whether truck # is currently found in TPMS_EXTRACT
  isManager: boolean("is_manager").default(false), // True if this tech's enterpriseId appears as a MANAGER_ENT_ID for some other tech in TPMS_EXTRACT
  category: varchar("category", { length: 20 }).notNull().default("standard"), // 'standard' (Active/Decommissioned) or 'old_decline' (Old Declines tab)
  // 3-category lifecycle lane (source of truth for the Decommissioning tabs). Non-destructive:
  // archived rows stay in this table and show in the Archived tab; nothing is ever deleted.
  lane: varchar("lane", { length: 20 }).notNull().default("declined"), // 'declined' | 'decommissioned' | 'archived'
  archivedAt: timestamp("archived_at"),
  archiveReason: varchar("archive_reason", { length: 50 }), // 'holman_oos' | 'holman_sold' | 'manual'
  holmanStatus: varchar("holman_status", { length: 30 }), // cached Holman status: Active | Out of Service | Sold
  holmanStatusSyncedAt: timestamp("holman_status_synced_at"),
  nearestTechName: varchar("nearest_tech_name", { length: 100 }),
  nearestTechPhone: varchar("nearest_tech_phone", { length: 50 }),
  nearestTechZip: varchar("nearest_tech_zip", { length: 20 }),
  nearestTechDistance: integer("nearest_tech_distance"),
  nearestTechEnterpriseId: varchar("nearest_tech_enterprise_id", { length: 50 }),
  partsCount: integer("parts_count"), // Sum of ON_HAND from NTAO_FIELD_VIEW_ASSORTMENT for latest CURR_DATE
  partsSpace: real("parts_space"), // CURRENT_TRUCK_CUFT from NTAO_FIELD_VIEW_ASSORTMENT for latest CURR_DATE
  partsCountSyncedAt: timestamp("parts_count_synced_at"),
  techDataSyncedAt: timestamp("tech_data_synced_at"),
  termRequestFileName: varchar("term_request_file_name", { length: 255 }),
  termRequestStorageKey: varchar("term_request_storage_key", { length: 500 }),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const insertDecommissioningVehicleSchema = createInsertSchema(decommissioningVehicles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type DecommissioningVehicle = typeof decommissioningVehicles.$inferSelect;
export type InsertDecommissioningVehicle = z.infer<typeof insertDecommissioningVehicleSchema>;

// Truck numbers explicitly removed from the Decommissioning table via the X button.
// PO-driven syncs (manual sweep + Final-Approval auto-sync) skip these so deletions are sticky.
export const decommExcludedTrucks = pgTable("fs_decomm_excluded_trucks", {
  truckNumber: varchar("truck_number", { length: 20 }).primaryKey(),
  excludedAt: timestamp("excluded_at").default(sql`now()`),
  excludedBy: varchar("excluded_by", { length: 100 }),
});

export type DecommExcludedTruck = typeof decommExcludedTrucks.$inferSelect;

// Registration Messages - bidirectional SMS conversations with technicians
export const regMessages = pgTable("fs_reg_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  truckNumber: text("truck_number").notNull(),
  techId: text("tech_id"),
  techPhone: text("tech_phone").notNull(),
  direction: text("direction").notNull(),
  body: text("body").notNull(),
  status: text("status").default("sent"),
  twilioSid: text("twilio_sid"),
  sentAt: timestamp("sent_at").default(sql`now()`),
  readAt: timestamp("read_at"),
  sentBy: text("sent_by"),
  senderName: text("sender_name"),
  autoTriggered: boolean("auto_triggered").default(false),
  triggerType: text("trigger_type"),
  mediaUrl: text("media_url"),
  mediaType: text("media_type"),
});

export const insertRegMessageSchema = createInsertSchema(regMessages).omit({ id: true, sentAt: true });
export type RegMessage = typeof regMessages.$inferSelect;
export type InsertRegMessage = z.infer<typeof insertRegMessageSchema>;

// Registration Scheduled Messages - deferred sends for TCPA quiet hours
export const regScheduledMessages = pgTable("fs_reg_scheduled_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  truckNumber: text("truck_number").notNull(),
  techId: text("tech_id"),
  techPhone: text("tech_phone").notNull(),
  body: text("body").notNull(),
  scheduledFor: timestamp("scheduled_for").notNull(),
  status: text("status").default("pending"), // 'pending'|'sent'|'cancelled'
  createdAt: timestamp("created_at").default(sql`now()`),
  sentAt: timestamp("sent_at"),
  messageId: text("message_id"),
});

export const insertRegScheduledMessageSchema = createInsertSchema(regScheduledMessages).omit({ id: true, createdAt: true });
export type RegScheduledMessage = typeof regScheduledMessages.$inferSelect;
export type InsertRegScheduledMessage = z.infer<typeof insertRegScheduledMessageSchema>;

export const rentalWeeklyManual = pgTable("fs_rental_weekly_manual", {
  id: serial("id").primaryKey(),
  weekYear: integer("week_year").notNull(),
  weekNumber: integer("week_number").notNull(),
  newRentals: integer("new_rentals").notNull().default(0),
  rentalsReturned: integer("rentals_returned").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
}, (table) => [
  sql`CREATE UNIQUE INDEX IF NOT EXISTS rental_weekly_manual_week_unique ON fs_rental_weekly_manual(week_year, week_number)`,
]);

export const insertRentalWeeklyManualSchema = createInsertSchema(rentalWeeklyManual).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type RentalWeeklyManual = typeof rentalWeeklyManual.$inferSelect;
export type InsertRentalWeeklyManual = z.infer<typeof insertRentalWeeklyManualSchema>;

export const callLogs = pgTable("fs_call_logs", {
  id: serial("id").primaryKey(),
  truckId: varchar("truck_id").notNull(),
  truckNumber: text("truck_number"),
  batchId: text("batch_id"),
  callTimestamp: timestamp("call_timestamp").default(sql`now()`),
  callType: text("call_type").notNull(),
  phoneNumber: text("phone_number"),
  elevenLabsConversationId: text("elevenlabs_conversation_id"),
  status: text("status").default("in_progress"),
  outcome: text("outcome"),
  estimatedReadyDate: text("estimated_ready_date"),
  blockers: text("blockers"),
  shopNotes: text("shop_notes"),
  transcript: text("transcript"),
  attemptNumber: integer("attempt_number").default(1),
  nextFollowUpDate: text("next_follow_up_date"),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const insertCallLogSchema = createInsertSchema(callLogs).omit({ id: true, createdAt: true });
export type CallLog = typeof callLogs.$inferSelect;
export type InsertCallLog = z.infer<typeof insertCallLogSchema>;

export const decommMessages = pgTable("fs_decomm_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  truckNumber: text("truck_number").notNull(),
  contactType: text("contact_type").notNull(),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone").notNull(),
  direction: text("direction").notNull(),
  body: text("body").notNull(),
  status: text("status").default("sent"),
  twilioSid: text("twilio_sid"),
  sentAt: timestamp("sent_at").default(sql`now()`),
  readAt: timestamp("read_at"),
  sentBy: text("sent_by"),
  senderName: text("sender_name"),
  mediaUrl: text("media_url"),
  mediaType: text("media_type"),
  ccForLdap: text("cc_for_ldap"), // Set when this is a manager-CC of a batch tech text; value is the tech's LDAP / enterprise ID
});

export const insertDecommMessageSchema = createInsertSchema(decommMessages).omit({ id: true, sentAt: true });
export type DecommMessage = typeof decommMessages.$inferSelect;
export type InsertDecommMessage = z.infer<typeof insertDecommMessageSchema>;

// ============================================================================
// Master Fleet Communications Module (Task #524)
// A single team SMS inbox: one thread per technician (keyed by LDAP), with
// per-message category labels. All tables use the fs_comms_ prefix and are
// managed via the raw-SQL init path (server/fleet-comms/schema-init.ts), NOT
// drizzle-kit push (see project Gotchas).
// ============================================================================

// The message categories. Category is a per-message label; tabs are filters.
export const COMMS_CATEGORIES = [
  "decommissioning",
  "registrations",
  "new_vehicles",
  "rental_management",
  "vehicle_assignments",
  "offboarding",
  "loa_rental",
  "general_fleet",
] as const;
export type CommsCategory = (typeof COMMS_CATEGORIES)[number];

export const COMMS_CATEGORY_LABELS: Record<CommsCategory, string> = {
  decommissioning: "Decommissioning",
  registrations: "Registrations",
  new_vehicles: "New Vehicles",
  rental_management: "Rental Management",
  vehicle_assignments: "Vehicle Assignments",
  offboarding: "Offboarding",
  loa_rental: "LOA Rental",
  general_fleet: "General Fleet",
};

// Communications Contacts — the module's self-contained directory, refreshed
// daily from the Active Roster + TPMS_EXTRACT. Keyed by LDAP (enterprise ID).
export const commsContacts = pgTable("fs_comms_contacts", {
  ldap: varchar("ldap", { length: 60 }).primaryKey(), // UPPER(TRIM(ENTERPRISE_ID))
  name: text("name"),
  district: text("district"),
  emplStatus: text("empl_status"), // A / L / P / S — last roster value; NOT cleared on tombstone (sync only flips `active`), so display must derive 'T' from active=false (see effectiveEmplStatus)
  managerLdap: text("manager_ldap"),
  managerName: text("manager_name"),
  phone: text("phone"), // display phone from TPMS MOBILEPHONENUMBER
  phoneDigits: varchar("phone_digits", { length: 10 }), // last-10 normalized, for matching
  primaryState: text("primary_state"), // for recipient-local quiet hours
  truckNumber: text("truck_number"),
  active: boolean("active").notNull().default(true),
  terminationDetectedAt: timestamp("termination_detected_at"), // set when dropped off roster
  lastSeenAt: timestamp("last_seen_at"), // last time present in the active roster
  phoneLastVerifiedAt: timestamp("phone_last_verified_at"), // last TPMS row seen with phone
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});
export type CommsContact = typeof commsContacts.$inferSelect;

// Per-contact phone-number change history (append-only).
export const commsPhoneHistory = pgTable("fs_comms_phone_history", {
  id: serial("id").primaryKey(),
  ldap: varchar("ldap", { length: 60 }).notNull(),
  phone: text("phone"),
  phoneDigits: varchar("phone_digits", { length: 10 }),
  changedAt: timestamp("changed_at").default(sql`now()`),
  source: text("source"), // 'sync' | 'manual_link'
  note: text("note"),
});
export type CommsPhoneHistory = typeof commsPhoneHistory.$inferSelect;

// Per-tech thread summary — the lightweight row the inbox list renders from.
export const commsThreads = pgTable("fs_comms_threads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  kind: text("kind").notNull().default("tech"), // 'tech' | 'unmatched'
  ldap: varchar("ldap", { length: 60 }), // null for unmatched threads
  phoneDigits: varchar("phone_digits", { length: 10 }), // current/known number (unmatched keyed on this)
  contactName: text("contact_name"), // denormalized
  district: text("district"),
  truckNumber: text("truck_number"),
  lastMessagePreview: text("last_message_preview"),
  lastMessageAt: timestamp("last_message_at"),
  lastMessageDirection: text("last_message_direction"),
  lastCategory: text("last_category"),
  unread: boolean("unread").notNull().default(false),
  unreadCount: integer("unread_count").notNull().default(0),
  optedOut: boolean("opted_out").notNull().default(false),
  lastViewedAt: timestamp("last_viewed_at"),
  lastViewedBy: text("last_viewed_by"),
  lastRepliedAt: timestamp("last_replied_at"),
  lastRepliedBy: text("last_replied_by"),
  // Soft-delete + manual archive lifecycle. active = both null; archived =
  // archivedAt set & deletedAt null; deleted = deletedAt set. Restore clears both.
  archivedAt: timestamp("archived_at"),
  archivedBy: text("archived_by"),
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});
export type CommsThread = typeof commsThreads.$inferSelect;

// Full message history — loaded/paginated only when a thread is opened.
export const commsMessages = pgTable("fs_comms_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: varchar("thread_id").notNull(),
  ldap: varchar("ldap", { length: 60 }),
  category: text("category").notNull().default("general_fleet"),
  direction: text("direction").notNull(), // 'inbound' | 'outbound'
  contactRole: text("contact_role").notNull().default("tech"), // 'tech' | 'manager' | 'unknown'
  body: text("body").notNull().default(""),
  phone: text("phone"), // number used at the time
  phoneDigits: varchar("phone_digits", { length: 10 }),
  status: text("status").default("sent"), // queued|sent|delivered|undelivered|failed|received
  twilioSid: text("twilio_sid"), // unique when present, for dedupe
  mediaUrl: text("media_url"), // object-storage key or Twilio URL
  mediaType: text("media_type"),
  sentBy: text("sent_by"), // app user id; null for system/inbound
  senderName: text("sender_name"),
  segments: integer("segments"),
  errorMessage: text("error_message"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").default(sql`now()`),
});
export type CommsMessage = typeof commsMessages.$inferSelect;

// Opt-out registry (STOP/START), keyed by phone digits.
export const commsOptOuts = pgTable("fs_comms_optouts", {
  phoneDigits: varchar("phone_digits", { length: 10 }).primaryKey(),
  optedOut: boolean("opted_out").notNull().default(true),
  reason: text("reason"), // 'STOP' | 'START' | 'manual'
  ldap: varchar("ldap", { length: 60 }),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});
export type CommsOptOut = typeof commsOptOuts.$inferSelect;

// Categorized message templates with whitelisted token placeholders.
export const commsTemplates = pgTable("fs_comms_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  category: text("category").notNull(),
  name: text("name").notNull(),
  body: text("body").notNull(),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});
export type CommsTemplate = typeof commsTemplates.$inferSelect;

// Thread audit — who viewed / who replied, for the shared-inbox audit trail.
export const commsThreadAudit = pgTable("fs_comms_thread_audit", {
  id: serial("id").primaryKey(),
  threadId: varchar("thread_id").notNull(),
  action: text("action").notNull(), // 'viewed' | 'replied'
  actor: text("actor"),
  actorName: text("actor_name"),
  at: timestamp("at").default(sql`now()`),
});
export type CommsThreadAudit = typeof commsThreadAudit.$inferSelect;

// Durable send queue — quiet-hours deferrals + chunked bulk sends. Every row
// carries a claimed/sent marker checked atomically (CAS) so a crashed-and-
// restarted processor can never text the same tech twice.
export const commsSendQueue = pgTable("fs_comms_send_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: varchar("batch_id"),
  ldap: varchar("ldap", { length: 60 }),
  phone: text("phone").notNull(),
  phoneDigits: varchar("phone_digits", { length: 10 }),
  category: text("category").notNull(),
  body: text("body").notNull(),
  mediaUrl: text("media_url"), // JSON array of URLs, or null
  managerCc: boolean("manager_cc").notNull().default(false),
  // When true, the drain must send to THIS row's phone as-enqueued and must NOT
  // re-resolve to the contact's current TPMS number. Used by LOA Rental outreach
  // to reach a tech's personal number (which is never in fs_comms_contacts).
  phoneLocked: boolean("phone_locked").notNull().default(false),
  scheduledFor: timestamp("scheduled_for"), // quiet-hours deferral target
  status: text("status").notNull().default("pending"), // pending|claimed|sent|failed|skipped|cancelled
  claimedAt: timestamp("claimed_at"),
  claimedBy: text("claimed_by"),
  sentAt: timestamp("sent_at"),
  twilioSid: text("twilio_sid"),
  errorMessage: text("error_message"),
  attempts: integer("attempts").notNull().default(0),
  createdBy: text("created_by"),
  senderName: text("sender_name"),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});
export type CommsSendQueueItem = typeof commsSendQueue.$inferSelect;

// Bulk-send batches — progress + failure reporting.
export const commsSendBatches = pgTable("fs_comms_send_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  category: text("category").notNull(),
  createdBy: text("created_by"),
  total: integer("total").notNull().default(0),
  sent: integer("sent").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  status: text("status").notNull().default("pending"), // pending|processing|completed
  filterDesc: text("filter_desc"),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});
export type CommsSendBatch = typeof commsSendBatches.$inferSelect;

// ============================================================================
// LOA Rental SMS outreach (Task #543)
// One state row per technician (LDAP). Tracks the unguessable public-form
// token, the daily-send watermark, the single pending resend, reply/form
// completion, and the staff re-enable escape hatch. Raw-SQL managed (DDL in
// server/fleet-comms/schema-init.ts), NOT drizzle-kit push.
// ============================================================================
export const loaOutreach = pgTable("fs_loa_outreach", {
  ldap: varchar("ldap", { length: 60 }).primaryKey(), // UPPER(TRIM(ENTERPRISE_ID))
  token: varchar("token", { length: 64 }).notNull(), // unguessable public-form token
  techName: text("tech_name"),
  truckNumber: text("truck_number"), // truck on file at last send (may be empty)
  lastCycleDate: text("last_cycle_date"), // ET yyyy-mm-dd of last daily send (per-day idempotency)
  lastSentAt: timestamp("last_sent_at"),
  lastSentPhones: text("last_sent_phones"), // digits, comma-separated, for the audit trail
  lastBody: text("last_body"), // rendered body of the last daily send (resend sends the same text)
  pendingResendAt: timestamp("pending_resend_at"), // when the single resend is due; null = none pending
  resendSentAt: timestamp("resend_sent_at"),
  repliedAt: timestamp("replied_at"), // any inbound reply (cancels the pending resend)
  formCompletedAt: timestamp("form_completed_at"), // form submitted → permanently excluded
  formTruckNumber: text("form_truck_number"), // truck # the tech entered on the form
  formData: jsonb("form_data"), // the six submitted answers, verbatim
  reenabledAt: timestamp("reenabled_at"), // staff re-enable; wins when >= formCompletedAt
  reenabledBy: text("reenabled_by"),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});
export type LoaOutreachRow = typeof loaOutreach.$inferSelect;
