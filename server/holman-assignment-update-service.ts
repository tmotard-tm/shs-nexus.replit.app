import { getTPMSService } from './tpms-service';
import { holmanApiService } from './holman-api-service';
import { holmanSubmissionService } from './holman-submission-service';

interface TechAddress {
  addressType: 'PRIMARY' | 'RE_ASSORTMENT' | 'DROP_RETURN' | 'ALTERNATE';
  shipToName?: string;
  addrLine1?: string;
  addrLine2?: string;
  city?: string;
  stateCd?: string;
  zipCd?: string;
}

interface TPMSTechData {
  enterpriseId: string;
  firstName: string;
  lastName: string;
  techId: string;
  districtNo: string;
  truckNo: string;
  primaryAddress?: {
    addrLine1?: string;
    addrLine2?: string;
    city?: string;
    stateCd?: string;
    zipCd?: string;
  };
  mobilePhone?: string;
}

interface HolmanAssignmentPayload {
  lesseeCode: string;
  holmanVehicleNumber: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  clientData1: string | null;
  clientData2: string | null;
  clientData3: string;
  clientData4: string | null;
  clientData5: string | null;
  clientData6: string | null;
  clientData7: string | null;
  assignedStatusCode: string;
  prefix: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressLine3: string | null;
  city: string | null;
  stateProvince: string | null;
  zipPostalCode: string | null;
  homePhone: string | null;
  workPhone: string | null;
  workPhoneExtension: string | null;
  cellPhone: string | null;
}

interface UpdateResult {
  success: boolean;
  holmanVehicleNumber: string;
  submissionId?: string;
  message?: string;
  error?: string;
  payload?: HolmanAssignmentPayload;
  response?: any;
}

class HolmanAssignmentUpdateService {
  private readonly LESSEE_CODE = '2B56';
  private readonly FLEET_EMAIL = 'FLEET_SUPPORT@TRANSFORMCO.COM';

  private normalizeString(val: any): string | null {
    if (val === null || val === undefined) return null;
    const s = String(val).trim();
    if (s === '' || s.toLowerCase() === 'null') return null;
    return s;
  }

  private cleanAddressString(val: any): string | null {
    const s = this.normalizeString(val);
    if (!s) return null;
    return s
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  private isBYOV(vehicleNumber: string): boolean {
    const normalized = vehicleNumber.replace(/^0+/, '');
    return normalized.startsWith('88');
  }

  private buildPayload(vehicleNumber: string, techData: TPMSTechData): HolmanAssignmentPayload {
    const paddedVehicleNumber = vehicleNumber.padStart(6, '0');
    const assignedStatusCode = this.isBYOV(vehicleNumber) ? 'D' : 'A';
    const districtPrefix = techData.districtNo ? techData.districtNo.slice(-4) : null;

    return {
      lesseeCode: this.LESSEE_CODE,
      holmanVehicleNumber: paddedVehicleNumber,
      email: this.FLEET_EMAIL,
      firstName: this.normalizeString(techData.firstName),
      lastName: this.normalizeString(techData.lastName),
      clientData1: techData.lastName ? techData.lastName.substring(0, 12) : null,
      clientData2: this.normalizeString(techData.enterpriseId),
      clientData3: '890',
      clientData4: null,
      clientData5: null,
      clientData6: null,
      clientData7: null,
      assignedStatusCode,
      prefix: districtPrefix,
      addressLine1: this.cleanAddressString(techData.primaryAddress?.addrLine1),
      addressLine2: this.cleanAddressString(techData.primaryAddress?.addrLine2),
      addressLine3: null,
      city: this.normalizeString(techData.primaryAddress?.city)?.toUpperCase() || null,
      stateProvince: this.normalizeString(techData.primaryAddress?.stateCd)?.toUpperCase() || null,
      zipPostalCode: this.normalizeString(techData.primaryAddress?.zipCd),
      homePhone: null,
      workPhone: this.normalizeString(techData.mobilePhone),
      workPhoneExtension: null,
      cellPhone: null,
    };
  }

  private buildUnassignPayload(vehicleNumber: string): HolmanAssignmentPayload {
    const paddedVehicleNumber = vehicleNumber.padStart(6, '0');
    
    return {
      lesseeCode: this.LESSEE_CODE,
      holmanVehicleNumber: paddedVehicleNumber,
      email: this.FLEET_EMAIL,
      firstName: null,
      lastName: null,
      clientData1: null,
      clientData2: null,
      clientData3: '890',
      clientData4: null,
      clientData5: null,
      clientData6: null,
      clientData7: null,
      assignedStatusCode: 'D',
      prefix: null,
      addressLine1: null,
      addressLine2: null,
      addressLine3: null,
      city: null,
      stateProvince: null,
      zipPostalCode: null,
      homePhone: null,
      workPhone: null,
      workPhoneExtension: null,
      cellPhone: null,
    };
  }

  async updateVehicleAssignment(
    vehicleNumber: string,
    enterpriseId?: string | null
  ): Promise<UpdateResult> {
    console.log(`[HolmanAssignmentUpdate] Starting update for vehicle ${vehicleNumber} with tech ${enterpriseId || 'UNASSIGN'}`);

    try {
      let payload: HolmanAssignmentPayload;

      if (!enterpriseId) {
        console.log(`[HolmanAssignmentUpdate] No enterprise ID - building unassign payload`);
        payload = this.buildUnassignPayload(vehicleNumber);
      } else {
        const tpmsService = getTPMSService();
        const techInfo = await tpmsService.getTechInfo(enterpriseId);
        console.log(`[HolmanAssignmentUpdate] Got TPMS tech info:`, {
          firstName: techInfo.firstName,
          lastName: techInfo.lastName,
          techId: techInfo.techId,
          districtNo: techInfo.districtNo,
          truckNo: techInfo.truckNo,
        });

        const primaryAddress = techInfo.addresses?.find((a: TechAddress) => a.addressType === 'PRIMARY');
        
        const techData: TPMSTechData = {
          enterpriseId: techInfo.ldapId || enterpriseId,
          firstName: techInfo.firstName,
          lastName: techInfo.lastName,
          techId: techInfo.techId,
          districtNo: techInfo.districtNo,
          truckNo: techInfo.truckNo,
          primaryAddress: primaryAddress ? {
            addrLine1: primaryAddress.addrLine1,
            addrLine2: primaryAddress.addrLine2,
            city: primaryAddress.city,
            stateCd: primaryAddress.stateCd,
            zipCd: primaryAddress.zipCd,
          } : undefined,
          mobilePhone: techInfo.contactNo,
        };

        payload = this.buildPayload(vehicleNumber, techData);
      }
      
      console.log(`[HolmanAssignmentUpdate] Built payload:`, JSON.stringify(payload, null, 2));

      const response = await holmanApiService.submitVehicleArray([payload]);
      console.log(`[HolmanAssignmentUpdate] Holman response:`, response);

      const submissionId = response?.submissionId || response?.id || null;
      const message = enterpriseId 
        ? 'Vehicle assignment updated successfully in Holman'
        : 'Vehicle unassigned successfully in Holman (technician data cleared)';

      // Save submission to database for tracking
      try {
        await holmanSubmissionService.createSubmission({
          holmanVehicleNumber: payload.holmanVehicleNumber,
          action: enterpriseId ? 'assign' : 'unassign',
          enterpriseId: enterpriseId || null,
          submissionId,
          payload,
          response,
        });
      } catch (dbError: any) {
        console.error(`[HolmanAssignmentUpdate] Failed to save submission to DB:`, dbError);
      }

      return {
        success: true,
        holmanVehicleNumber: payload.holmanVehicleNumber,
        submissionId,
        message,
        payload,
        response,
      };
    } catch (error: any) {
      console.error(`[HolmanAssignmentUpdate] Error:`, error);
      return {
        success: false,
        holmanVehicleNumber: vehicleNumber,
        error: error.message || 'Unknown error occurred',
      };
    }
  }

  async updateMultipleVehicleAssignments(
    updates: Array<{ vehicleNumber: string; enterpriseId: string }>
  ): Promise<UpdateResult[]> {
    const results: UpdateResult[] = [];
    
    for (const update of updates) {
      const result = await this.updateVehicleAssignment(
        update.vehicleNumber,
        update.enterpriseId
      );
      results.push(result);
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return results;
  }
}

export const holmanAssignmentUpdateService = new HolmanAssignmentUpdateService();
