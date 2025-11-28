import { storage } from './storage';

interface TPMSToken {
  token: string;
  expiresAt: number;
}

interface TechInfoResponse {
  correlationId: string;
  messages: string[];
  ldapId: string;
  firstName: string;
  lastName: string;
  techId: string;
  districtNo: string;
  techManagerLdapId: string;
  truckNo: string;
  contactNo?: string;
  email?: string;
  addresses?: TechAddress[];
  latestShippingHold?: ShippingHold;
  techReplenishment?: TechReplenishment;
}

interface TechAddress {
  addressType: 'PRIMARY' | 'RE_ASSORTMENT' | 'DROP_RETURN' | 'ALTERNATE';
  shipToName?: string;
  addrLine1?: string;
  addrLine2?: string;
  city?: string;
  stateCd?: string;
  zipCd?: string;
}

interface ShippingHold {
  beginDate: string;
  endDate: string;
  holdReason: string;
}

interface TechReplenishment {
  primarySrc?: string;
  providerName?: string;
  storeLocation?: string;
  alternateAddress?: TechAddress;
  overridePrimarySrc?: boolean;
}

export interface TruckLookupResult {
  success: boolean;
  truckNo?: string;
  techInfo?: TechInfoResponse;
  error?: string;
}

class TPMSService {
  private cachedToken: TPMSToken | null = null;
  private authEndpoint: string;
  private apiEndpoint: string;
  private basicAuthCredential: string;

  constructor() {
    this.authEndpoint = process.env.TPMS_AUTH_ENDPOINT || '';
    this.apiEndpoint = process.env.TPMS_API_ENDPOINT || '';
    this.basicAuthCredential = process.env.TPMS_AUTHORIZATION || process.env.TPMS_CLIENT_SECRET || '';
    
    if (!this.authEndpoint) {
      console.warn('[TPMS] Warning: TPMS_AUTH_ENDPOINT not configured');
    }
    if (!this.apiEndpoint) {
      console.warn('[TPMS] Warning: TPMS_API_ENDPOINT not configured');
    }
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60000) {
      return this.cachedToken.token;
    }

    console.log('[TPMS] Fetching new auth token...');
    console.log('[TPMS] Auth endpoint URL:', this.authEndpoint);

    if (!this.authEndpoint || !this.basicAuthCredential) {
      throw new Error('TPMS authentication not configured. Please set TPMS_AUTH_ENDPOINT and TPMS_AUTHORIZATION.');
    }

    try {
      const authHeader = this.basicAuthCredential.startsWith('Basic ') 
        ? this.basicAuthCredential 
        : `Basic ${this.basicAuthCredential}`;
      console.log('[TPMS] Using auth header format:', authHeader.substring(0, 15) + '...');
      
      const response = await fetch(this.authEndpoint, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Auth request failed: ${response.status} - ${errorText}`);
      }

      const xmlText = await response.text();
      console.log('[TPMS] Auth response received, parsing XML...');
      
      const token = this.extractTokenFromXml(xmlText);
      
      if (!token) {
        throw new Error('Failed to extract token from auth response');
      }

      this.cachedToken = {
        token,
        expiresAt: now + (60 * 60 * 1000),
      };

      console.log('[TPMS] Token obtained successfully');
      return token;
    } catch (error: any) {
      console.error('[TPMS] Authentication error:', error.message);
      throw new Error(`TPMS authentication failed: ${error.message}`);
    }
  }

  private extractTokenFromXml(xml: string): string | null {
    const ns2Match = xml.match(/<ns2:token>([\s\S]*?)<\/ns2:token>/i);
    if (ns2Match) {
      return ns2Match[1].trim();
    }

    const simpleMatch = xml.match(/<token>([\s\S]*?)<\/token>/i);
    if (simpleMatch) {
      return simpleMatch[1].trim();
    }

    const tokenAttrMatch = xml.match(/token["\s]*[:=]["\s]*([^"<>\s]+)/i);
    if (tokenAttrMatch) {
      return tokenAttrMatch[1].trim();
    }

    console.error('[TPMS] Could not extract token from XML:', xml.substring(0, 500));
    return null;
  }

  async getTechInfo(enterpriseId: string): Promise<TechInfoResponse> {
    if (!enterpriseId) {
      throw new Error('Enterprise ID is required');
    }

    const token = await this.getToken();
    const cleanId = enterpriseId.trim().toUpperCase();
    
    const baseUrl = this.apiEndpoint.endsWith('/') ? this.apiEndpoint.slice(0, -1) : this.apiEndpoint;
    const url = `${baseUrl}/techinfo/${cleanId}`;
    console.log(`[TPMS] Fetching tech info for: ${cleanId}`);
    console.log(`[TPMS] Tech info URL: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tech info request failed: ${response.status} - ${errorText}`);
      }

      const data: TechInfoResponse = await response.json();
      
      if (data.messages && !data.messages.includes('SUCCESS')) {
        throw new Error(`TPMS error: ${data.messages.join(', ')}`);
      }

      console.log(`[TPMS] Tech info retrieved successfully for ${cleanId}, Truck: ${data.truckNo || 'N/A'}`);
      return data;
    } catch (error: any) {
      console.error(`[TPMS] Error fetching tech info for ${cleanId}:`, error.message);
      throw error;
    }
  }

  async lookupTruckByEnterpriseId(enterpriseId: string): Promise<TruckLookupResult> {
    try {
      const techInfo = await this.getTechInfo(enterpriseId);
      
      return {
        success: true,
        truckNo: techInfo.truckNo?.trim() || undefined,
        techInfo,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async lookupByTruckNumber(truckNumber: string): Promise<{ success: boolean; data?: TechInfoResponse; message?: string }> {
    const cleanTruckNo = truckNumber.trim();
    console.log(`[TPMS] Looking up tech by truck number: ${cleanTruckNo}`);
    
    try {
      const token = await this.getToken();
      
      const url = `${this.apiEndpoint}/TechProfile/TechByTruckNo/${cleanTruckNo}`;
      console.log(`[TPMS] Truck lookup URL: ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[TPMS] Truck lookup failed: ${response.status} - ${errorText}`);
        return {
          success: false,
          message: `Truck lookup failed: ${response.status} - No tech found for truck ${cleanTruckNo}`,
        };
      }

      const data: TechInfoResponse = await response.json();
      
      if (data.messages && !data.messages.includes('SUCCESS')) {
        return {
          success: false,
          message: `TPMS error: ${data.messages.join(', ')}`,
        };
      }

      console.log(`[TPMS] Tech found for truck ${cleanTruckNo}: ${data.firstName} ${data.lastName}`);
      return {
        success: true,
        data,
      };
    } catch (error: any) {
      console.error(`[TPMS] Error looking up truck ${cleanTruckNo}:`, error.message);
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      if (!this.authEndpoint || !this.basicAuthCredential || !this.apiEndpoint) {
        return {
          success: false,
          message: 'TPMS is not fully configured. Please set TPMS_AUTH_ENDPOINT, TPMS_API_ENDPOINT, and TPMS_AUTHORIZATION.',
        };
      }

      const token = await this.getToken();
      
      return {
        success: true,
        message: 'TPMS connection successful. Token obtained.',
      };
    } catch (error: any) {
      return {
        success: false,
        message: `TPMS connection failed: ${error.message}`,
      };
    }
  }

  isConfigured(): boolean {
    return !!(this.authEndpoint && this.apiEndpoint && this.basicAuthCredential);
  }
}

let tpmsServiceInstance: TPMSService | null = null;

export function getTPMSService(): TPMSService {
  if (!tpmsServiceInstance) {
    tpmsServiceInstance = new TPMSService();
  }
  return tpmsServiceInstance;
}

export function resetTPMSService(): void {
  tpmsServiceInstance = null;
}
