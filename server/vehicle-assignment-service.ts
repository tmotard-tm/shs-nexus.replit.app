import { storage } from './storage';
import { getTPMSService } from './tpms-service';
import { holmanApiService } from './holman-api-service';
import { isSnowflakeConfigured } from './snowflake-service';
import { toCanonical } from './vehicle-number-utils';
import type { 
  TechVehicleAssignment, 
  InsertTechVehicleAssignment,
  InsertTechVehicleAssignmentHistory,
  AggregatedVehicleAssignment,
  AllTech 
} from '@shared/schema';

interface TPMSAddress {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
}

interface EnrichedAssignment extends TechVehicleAssignment {
  snowflakeData?: AllTech;
  holmanData?: {
    year: string;
    make: string;
    model: string;
    holmanVehicleNumber: string;
    vin?: string;
    status?: string;
    garagingAddress?: string;
  };
  dataSources: {
    snowflake: boolean;
    tpms: boolean;
    holman: boolean;
  };
}

interface AssignmentFilters {
  status?: string;
  districtNo?: string;
  truckNo?: string;
  search?: string;
}

interface PaginationOptions {
  page?: number;
  limit?: number;
}

export class VehicleAssignmentService {
  
  isFullyConfigured(): boolean {
    const tpmsService = getTPMSService();
    return isSnowflakeConfigured() && tpmsService.isConfigured() && holmanApiService.hasCredentials();
  }
  
  async getAggregatedAssignments(
    filters?: AssignmentFilters,
    pagination?: PaginationOptions
  ): Promise<AggregatedVehicleAssignment[]> {
    const assignments = await storage.getTechVehicleAssignments(filters?.status);
    
    let filteredAssignments = assignments;
    
    if (filters?.districtNo) {
      filteredAssignments = filteredAssignments.filter(a => a.districtNo === filters.districtNo);
    }
    
    if (filters?.truckNo) {
      const normalizedFilter = this.normalizeTruckNumber(filters.truckNo);
      filteredAssignments = filteredAssignments.filter(a => 
        a.truckNo && this.normalizeTruckNumber(a.truckNo).includes(normalizedFilter)
      );
    }
    
    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      filteredAssignments = filteredAssignments.filter(a =>
        (a.techName || '').toLowerCase().includes(searchLower) ||
        (a.firstName || '').toLowerCase().includes(searchLower) ||
        (a.lastName || '').toLowerCase().includes(searchLower) ||
        (a.techRacfid || '').toLowerCase().includes(searchLower) ||
        (a.employeeId || '').toLowerCase().includes(searchLower) ||
        (a.truckNo || '').toLowerCase().includes(searchLower)
      );
    }
    
    const page = pagination?.page || 1;
    const limit = pagination?.limit || 50;
    const startIndex = (page - 1) * limit;
    const paginatedAssignments = filteredAssignments.slice(startIndex, startIndex + limit);
    
    // Use Promise.all for parallel enrichment instead of sequential N+1 pattern
    // This significantly improves performance when enriching multiple assignments
    const enrichedAssignments = await Promise.all(
      paginatedAssignments.map(assignment => this.enrichAssignmentData(assignment))
    );
    
    return enrichedAssignments;
  }

  async getAggregatedAssignmentByTechRacfid(techRacfid: string): Promise<AggregatedVehicleAssignment | null> {
    let assignment = await storage.getTechVehicleAssignmentByTechRacfid(techRacfid);
    
    if (!assignment) {
      const tpmsData = await this.fetchTPMSData(techRacfid);
      if (tpmsData) {
        const created = await this.createAssignmentFromTPMS(techRacfid, tpmsData);
        if (created) {
          assignment = created;
        }
      }
    }
    
    if (!assignment) {
      const allTech = await storage.getAllTechByEmployeeId(techRacfid) || 
                      await this.findTechByEnterpriseId(techRacfid);
      if (allTech) {
        return this.createPartialAggregatedAssignment(allTech);
      }
      return null;
    }
    
    return this.enrichAssignmentData(assignment);
  }

  async getAggregatedAssignmentByTruckNo(truckNo: string): Promise<AggregatedVehicleAssignment | null> {
    const normalizedTruckNo = this.normalizeTruckNumber(truckNo);
    
    let assignment = await storage.getTechVehicleAssignmentByTruckNo(normalizedTruckNo);
    
    if (!assignment) {
      const tpmsService = getTPMSService();
      if (tpmsService.isConfigured()) {
        try {
          const lookupResult = await tpmsService.lookupByTruckNumber(normalizedTruckNo);
          if (lookupResult.success && lookupResult.data) {
            const created = await this.createAssignmentFromTPMS(lookupResult.data.ldapId, lookupResult.data);
            if (created) {
              assignment = created;
            }
          }
        } catch (error) {
          console.error('[VehicleAssignment] Error looking up by truck:', error);
        }
      }
    }
    
    if (!assignment) {
      const holmanResult = await this.fetchHolmanVehicleData(normalizedTruckNo);
      if (holmanResult) {
        return {
          techRacfid: '',
          assignmentStatus: 'inactive',
          truckNo: normalizedTruckNo,
          holmanVehicleNumber: holmanResult.holmanVehicleNumber,
          vehicleVin: holmanResult.vin,
          vehicleYear: holmanResult.year,
          vehicleMake: holmanResult.make,
          vehicleModel: holmanResult.model,
          vehicleStatus: holmanResult.status,
          garagingAddress: holmanResult.garagingAddress,
          dataSources: { snowflake: false, tpms: false, holman: true },
        };
      }
      return null;
    }
    
    return this.enrichAssignmentData(assignment);
  }

  async syncFromTPMS(techRacfid: string, changedBy?: string): Promise<AggregatedVehicleAssignment | null> {
    const tpmsData = await this.fetchTPMSData(techRacfid);
    if (!tpmsData) {
      return null;
    }
    
    const existingAssignment = await storage.getTechVehicleAssignmentByTechRacfid(techRacfid);
    const previousTruckNo = existingAssignment?.truckNo;
    const newTruckNo = tpmsData.truckNo?.trim() || null;
    
    if (existingAssignment) {
      const updates: Partial<TechVehicleAssignment> = {
        truckNo: newTruckNo,
        techId: tpmsData.techId,
        techName: `${tpmsData.firstName} ${tpmsData.lastName}`.trim(),
        firstName: tpmsData.firstName,
        lastName: tpmsData.lastName,
        districtNo: tpmsData.districtNo,
        contactNo: tpmsData.contactNo,
        email: tpmsData.email,
        lastTpmsSync: new Date(),
        tpmsDataRaw: JSON.stringify(tpmsData),
      };
      
      const updated = await storage.updateTechVehicleAssignment(existingAssignment.id, updates);
      
      if (previousTruckNo !== newTruckNo) {
        await this.logAssignmentChange(
          techRacfid,
          newTruckNo,
          previousTruckNo,
          previousTruckNo ? 'changed' : 'assigned',
          'tpms_sync',
          changedBy
        );
      }
      
      if (updated) {
        return this.enrichAssignmentData(updated);
      }
    } else {
      const newAssignment = await this.createAssignmentFromTPMS(techRacfid, tpmsData);
      if (newAssignment) {
        await this.logAssignmentChange(
          techRacfid,
          newTruckNo,
          null,
          'assigned',
          'tpms_sync',
          changedBy
        );
        return this.enrichAssignmentData(newAssignment);
      }
    }
    
    return null;
  }

  async createOrUpdateAssignment(
    techRacfid: string,
    truckNo: string | null,
    assignmentStatus: 'active' | 'inactive' | 'pending',
    changedBy?: string,
    notes?: string
  ): Promise<AggregatedVehicleAssignment | null> {
    const existingAssignment = await storage.getTechVehicleAssignmentByTechRacfid(techRacfid);
    const previousTruckNo = existingAssignment?.truckNo;
    
    const allTech = await storage.getAllTechByEmployeeId(techRacfid) ||
                    await this.findTechByEnterpriseId(techRacfid);
    
    if (existingAssignment) {
      const updates: Partial<TechVehicleAssignment> = {
        truckNo: truckNo,
        assignmentStatus: assignmentStatus,
      };
      
      if (allTech) {
        updates.employeeId = allTech.employeeId;
        updates.techName = allTech.techName;
        updates.firstName = allTech.firstName;
        updates.lastName = allTech.lastName;
        updates.districtNo = allTech.districtNo;
      }
      
      const updated = await storage.updateTechVehicleAssignment(existingAssignment.id, updates);
      
      const changeType = this.determineChangeType(previousTruckNo, truckNo);
      if (changeType) {
        await this.logAssignmentChange(
          techRacfid,
          truckNo,
          previousTruckNo,
          changeType,
          'manual',
          changedBy,
          notes
        );
      } else {
        // Truck number is unchanged — log status_changed or updated based on whether status changed
        const previousStatus = existingAssignment.assignmentStatus;
        if (previousStatus !== assignmentStatus) {
          await this.logAssignmentChange(
            techRacfid,
            truckNo,
            previousTruckNo,
            'status_changed',
            'manual',
            changedBy,
            notes || `Status changed from ${previousStatus} to ${assignmentStatus}`
          );
        } else {
          // Truck and status both unchanged — still log as a generic update
          await this.logAssignmentChange(
            techRacfid,
            truckNo,
            previousTruckNo,
            'updated',
            'manual',
            changedBy,
            notes || 'Assignment saved'
          );
        }
      }
      
      if (updated) {
        return this.enrichAssignmentData(updated);
      }
    } else {
      const newAssignment: InsertTechVehicleAssignment = {
        techRacfid: techRacfid.toUpperCase(),
        truckNo: truckNo,
        assignmentStatus: assignmentStatus,
        employeeId: allTech?.employeeId,
        techName: allTech?.techName,
        firstName: allTech?.firstName,
        lastName: allTech?.lastName,
        districtNo: allTech?.districtNo,
      };
      
      const created = await storage.createTechVehicleAssignment(newAssignment);
      
      if (truckNo) {
        await this.logAssignmentChange(
          techRacfid,
          truckNo,
          null,
          'assigned',
          'manual',
          changedBy,
          notes
        );
      }
      
      return this.enrichAssignmentData(created);
    }
    
    return null;
  }

  async unassignVehicle(
    techRacfid: string,
    changedBy?: string,
    notes?: string
  ): Promise<AggregatedVehicleAssignment | null> {
    const existingAssignment = await storage.getTechVehicleAssignmentByTechRacfid(techRacfid);
    
    if (!existingAssignment) {
      return null;
    }
    
    const previousTruckNo = existingAssignment.truckNo;
    
    const updated = await storage.updateTechVehicleAssignment(existingAssignment.id, {
      truckNo: null,
      assignmentStatus: 'inactive',
    });
    
    if (previousTruckNo) {
      await this.logAssignmentChange(
        techRacfid,
        null,
        previousTruckNo,
        'unassigned',
        'manual',
        changedBy,
        notes
      );
    }
    
    if (updated) {
      return this.enrichAssignmentData(updated);
    }
    
    return null;
  }

  async logTruckInfoUpdate(
    truckNo: string,
    changedBy?: string,
    notes?: string
  ): Promise<void> {
    const assignment = await storage.getTechVehicleAssignmentByTruckNo(truckNo);
    if (!assignment) return;
    await this.logAssignmentChange(
      assignment.techRacfid,
      truckNo,
      truckNo,
      'updated',
      'manual',
      changedBy,
      notes || 'Truck details manually edited'
    );
  }

  async logVehicleInfoUpdate(
    vehicleNumber: string,
    changedBy?: string,
    notes?: string
  ): Promise<void> {
    // Try matching by the raw vehicleNumber first, then by TPMS-padded format
    let assignment = await storage.getTechVehicleAssignmentByTruckNo(vehicleNumber);
    if (!assignment) {
      const tpmsRef = vehicleNumber.replace(/^0+/, '').padStart(6, '0');
      if (tpmsRef !== vehicleNumber) {
        assignment = await storage.getTechVehicleAssignmentByTruckNo(tpmsRef);
      }
    }
    if (!assignment) return;
    await this.logAssignmentChange(
      assignment.techRacfid,
      assignment.truckNo,
      assignment.truckNo,
      'updated',
      'manual',
      changedBy,
      notes || 'Vehicle info manually updated'
    );
  }

  async searchTechnicians(query: string): Promise<AllTech[]> {
    const allTechs = await storage.getAllTechs();
    const searchLower = query.toLowerCase();
    
    return allTechs.filter(tech => {
      const name = (tech.techName || '').toLowerCase();
      const firstName = (tech.firstName || '').toLowerCase();
      const lastName = (tech.lastName || '').toLowerCase();
      const enterpriseId = (tech.techRacfid || '').toLowerCase();
      const employeeId = (tech.employeeId || '').toLowerCase();
      
      return name.includes(searchLower) ||
             firstName.includes(searchLower) ||
             lastName.includes(searchLower) ||
             enterpriseId.includes(searchLower) ||
             employeeId.includes(searchLower);
    }).slice(0, 20);
  }

  async getAssignmentHistory(techRacfid: string) {
    return storage.getTechVehicleAssignmentHistory(techRacfid);
  }

  private async enrichAssignmentData(assignment: TechVehicleAssignment): Promise<AggregatedVehicleAssignment> {
    const result: AggregatedVehicleAssignment = {
      id: assignment.id,
      techRacfid: assignment.techRacfid,
      assignmentStatus: assignment.assignmentStatus as 'active' | 'inactive' | 'pending',
      lastTpmsSync: assignment.lastTpmsSync?.toISOString() || null,
      createdAt: assignment.createdAt?.toISOString(),
      updatedAt: assignment.updatedAt?.toISOString(),
      
      employeeId: assignment.employeeId,
      techName: assignment.techName,
      firstName: assignment.firstName,
      lastName: assignment.lastName,
      districtNo: assignment.districtNo,
      
      truckNo: assignment.truckNo,
      techId: assignment.techId,
      contactNo: assignment.contactNo,
      email: assignment.email,
      
      dataSources: {
        snowflake: false,
        tpms: !!assignment.lastTpmsSync,
        holman: false,
      },
    };
    
    const allTech = await storage.getAllTechByEmployeeId(assignment.employeeId || '') ||
                    await this.findTechByEnterpriseId(assignment.techRacfid);
    if (allTech) {
      result.employmentStatus = allTech.employmentStatus;
      result.dataSources!.snowflake = true;
      
      if (!result.techName) result.techName = allTech.techName;
      if (!result.firstName) result.firstName = allTech.firstName;
      if (!result.lastName) result.lastName = allTech.lastName;
      if (!result.districtNo) result.districtNo = allTech.districtNo;
    }
    
    if (assignment.truckNo) {
      const holmanData = await this.fetchHolmanVehicleData(assignment.truckNo);
      if (holmanData) {
        result.holmanVehicleNumber = holmanData.holmanVehicleNumber;
        result.vehicleVin = holmanData.vin;
        result.vehicleYear = holmanData.year;
        result.vehicleMake = holmanData.make;
        result.vehicleModel = holmanData.model;
        result.vehicleStatus = holmanData.status;
        result.garagingAddress = holmanData.garagingAddress;
        result.dataSources!.holman = true;
      }
    }
    
    return result;
  }

  private createPartialAggregatedAssignment(allTech: AllTech): AggregatedVehicleAssignment {
    return {
      techRacfid: allTech.techRacfid || '',
      assignmentStatus: 'inactive',
      
      employeeId: allTech.employeeId,
      techName: allTech.techName,
      firstName: allTech.firstName,
      lastName: allTech.lastName,
      districtNo: allTech.districtNo,
      employmentStatus: allTech.employmentStatus,
      
      dataSources: {
        snowflake: true,
        tpms: false,
        holman: false,
      },
    };
  }

  private async fetchTPMSData(techRacfid: string) {
    const tpmsService = getTPMSService();
    if (!tpmsService.isConfigured()) {
      console.log('[VehicleAssignment] TPMS not configured, skipping TPMS lookup');
      return null;
    }
    
    try {
      return await tpmsService.getTechInfo(techRacfid);
    } catch (error) {
      console.error('[VehicleAssignment] Error fetching TPMS data:', error);
      return null;
    }
  }

  private async fetchHolmanVehicleData(truckNo: string) {
    try {
      const normalizedTruckNo = this.normalizeTruckNumber(truckNo);
      const result = await holmanApiService.findVehicleByNumber(normalizedTruckNo);
      if (result.success && result.vehicle) {
        return result.vehicle;
      }
    } catch (error) {
      console.error('[VehicleAssignment] Error fetching Holman data:', error);
    }
    return null;
  }

  private async createAssignmentFromTPMS(techRacfid: string, tpmsData: any): Promise<TechVehicleAssignment | null> {
    try {
      const allTech = await this.findTechByEnterpriseId(techRacfid);
      
      const newAssignment: InsertTechVehicleAssignment = {
        techRacfid: techRacfid.toUpperCase(),
        employeeId: allTech?.employeeId || null,
        techName: `${tpmsData.firstName} ${tpmsData.lastName}`.trim(),
        firstName: tpmsData.firstName,
        lastName: tpmsData.lastName,
        districtNo: tpmsData.districtNo,
        truckNo: tpmsData.truckNo?.trim() || null,
        techId: tpmsData.techId,
        contactNo: tpmsData.contactNo,
        email: tpmsData.email,
        assignmentStatus: tpmsData.truckNo ? 'active' : 'pending',
        lastTpmsSync: new Date(),
        tpmsDataRaw: JSON.stringify(tpmsData),
      };
      
      return await storage.createTechVehicleAssignment(newAssignment);
    } catch (error) {
      console.error('[VehicleAssignment] Error creating assignment from TPMS:', error);
      return null;
    }
  }

  private async findTechByEnterpriseId(enterpriseId: string): Promise<AllTech | undefined> {
    const allTechs = await storage.getAllTechs();
    return allTechs.find(t => 
      t.techRacfid?.toUpperCase() === enterpriseId.toUpperCase()
    );
  }

  private normalizeTruckNumber(truckNo: string): string {
    return toCanonical(truckNo);
  }

  private determineChangeType(
    previousTruckNo: string | null | undefined,
    newTruckNo: string | null | undefined
  ): 'assigned' | 'unassigned' | 'changed' | null {
    const hadTruck = !!previousTruckNo;
    const hasTruck = !!newTruckNo;
    
    if (!hadTruck && hasTruck) return 'assigned';
    if (hadTruck && !hasTruck) return 'unassigned';
    if (hadTruck && hasTruck && previousTruckNo !== newTruckNo) return 'changed';
    return null;
  }

  private async logAssignmentChange(
    techRacfid: string,
    truckNo: string | null | undefined,
    previousTruckNo: string | null | undefined,
    changeType: 'assigned' | 'unassigned' | 'changed' | 'status_changed' | 'updated',
    changeSource: 'manual' | 'tpms_sync' | 'offboarding',
    changedBy?: string,
    notes?: string
  ): Promise<void> {
    const historyEntry: InsertTechVehicleAssignmentHistory = {
      techRacfid: techRacfid.toUpperCase(),
      truckNo: truckNo || null,
      previousTruckNo: previousTruckNo || null,
      changeType,
      changeSource,
      changedBy: changedBy || null,
      notes: notes || null,
    };
    
    try {
      await storage.createTechVehicleAssignmentHistory(historyEntry);
    } catch (error) {
      console.error('[VehicleAssignment] Error logging assignment change:', error);
    }
  }
}

export const vehicleAssignmentService = new VehicleAssignmentService();
