import { storage } from './storage';
import type { InsertTpmsCachedAssignment } from '@shared/schema';

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
  source?: 'live' | 'cached'; // Indicates whether data came from API or cache
  cacheAge?: number; // Age of cached data in hours
}

export interface CachedTechInfo {
  techInfo: TechInfoResponse;
  source: 'live' | 'cached';
  cacheAge?: number;
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

    if (!this.authEndpoint || !this.basicAuthCredential) {
      throw new Error('TPMS authentication not configured. Please set TPMS_AUTH_ENDPOINT and TPMS_AUTHORIZATION.');
    }

    try {
      const authHeader = this.basicAuthCredential.startsWith('Basic ') 
        ? this.basicAuthCredential 
        : `Basic ${this.basicAuthCredential}`;
      
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

  // Raw API call - does not use cache
  async getTechInfo(enterpriseId: string): Promise<TechInfoResponse> {
    if (!enterpriseId) {
      throw new Error('Enterprise ID is required');
    }

    const token = await this.getToken();
    const cleanId = enterpriseId.trim().toUpperCase();
    
    const baseUrl = this.apiEndpoint.endsWith('/') ? this.apiEndpoint.slice(0, -1) : this.apiEndpoint;
    const url = `${baseUrl}/techinfo/${cleanId}`;
    console.log(`[TPMS] Fetching tech info for: ${cleanId}`);

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
      const error = new Error(`Tech info request failed: ${response.status} - ${errorText}`);
      (error as any).statusCode = response.status;
      throw error;
    }

    const data: TechInfoResponse = await response.json();
    
    if (data.messages && !data.messages.includes('SUCCESS')) {
      throw new Error(`TPMS error: ${data.messages.join(', ')}`);
    }

    console.log(`[TPMS] Tech info retrieved successfully for ${cleanId}, Truck: ${data.truckNo || 'N/A'}`);
    return data;
  }

  // Cache a successful TPMS response
  private async cacheTPMSResponse(lookupKey: string, lookupType: 'enterprise_id' | 'truck_number', techInfo: TechInfoResponse): Promise<void> {
    try {
      const cacheData: InsertTpmsCachedAssignment = {
        lookupKey: lookupKey.toUpperCase(),
        lookupType,
        truckNo: techInfo.truckNo?.trim() || null,
        enterpriseId: techInfo.ldapId?.toUpperCase() || null,
        techId: techInfo.techId || null,
        firstName: techInfo.firstName || null,
        lastName: techInfo.lastName || null,
        districtNo: techInfo.districtNo || null,
        contactNo: techInfo.contactNo || null,
        email: techInfo.email || null,
        rawResponse: JSON.stringify(techInfo),
        status: 'live',
        lastSuccessAt: new Date(),
        lastAttemptAt: new Date(),
        failureCount: 0,
      };
      
      await storage.upsertTpmsCachedAssignment(cacheData);
      console.log(`[TPMS-Cache] Cached successful response for ${lookupKey}`);
    } catch (error: any) {
      console.error(`[TPMS-Cache] Error caching response for ${lookupKey}:`, error.message);
    }
  }

  // Get tech info with caching - tries API first, falls back to cache on failure
  async getTechInfoWithCache(enterpriseId: string): Promise<CachedTechInfo | null> {
    const cleanId = enterpriseId.trim().toUpperCase();
    
    try {
      // Try live API first
      const techInfo = await this.getTechInfo(cleanId);
      
      // Cache the successful response
      await this.cacheTPMSResponse(cleanId, 'enterprise_id', techInfo);
      
      return {
        techInfo,
        source: 'live',
      };
    } catch (error: any) {
      const statusCode = (error as any).statusCode || 0;
      console.warn(`[TPMS-Cache] API failed for ${cleanId} (status: ${statusCode}), checking cache...`);
      
      // Record the error in cache
      const existingCache = await storage.getTpmsCachedAssignment(cleanId);
      if (existingCache) {
        await storage.markTpmsCacheError(cleanId, statusCode, error.message);
      }
      
      // Look for cached data - try by lookupKey first, then by enterpriseId
      let cached = await storage.getTpmsCachedAssignment(cleanId);
      if (!cached) {
        cached = await storage.getTpmsCachedAssignmentByEnterpriseId(cleanId);
      }
      
      if (cached && cached.rawResponse) {
        try {
          const techInfo: TechInfoResponse = JSON.parse(cached.rawResponse);
          const cacheAge = cached.lastSuccessAt 
            ? Math.round((Date.now() - new Date(cached.lastSuccessAt).getTime()) / (1000 * 60 * 60))
            : undefined;
          
          console.log(`[TPMS-Cache] Returning cached data for ${cleanId} (age: ${cacheAge}h)`);
          return {
            techInfo,
            source: 'cached',
            cacheAge,
          };
        } catch (parseError) {
          console.error(`[TPMS-Cache] Failed to parse cached data for ${cleanId}`);
        }
      }
      
      console.warn(`[TPMS-Cache] No cached data available for ${cleanId}`);
      return null;
    }
  }

  // Get cached data by truck number
  async getCachedByTruckNo(truckNo: string): Promise<CachedTechInfo | null> {
    const cached = await storage.getTpmsCachedAssignmentByTruckNo(truckNo);
    
    if (cached && cached.rawResponse) {
      try {
        const techInfo: TechInfoResponse = JSON.parse(cached.rawResponse);
        const cacheAge = cached.lastSuccessAt 
          ? Math.round((Date.now() - new Date(cached.lastSuccessAt).getTime()) / (1000 * 60 * 60))
          : undefined;
        
        return {
          techInfo,
          source: 'cached',
          cacheAge,
        };
      } catch (parseError) {
        console.error(`[TPMS-Cache] Failed to parse cached data for truck ${truckNo}`);
      }
    }
    
    return null;
  }

  async lookupTruckByEnterpriseId(enterpriseId: string): Promise<TruckLookupResult> {
    const result = await this.getTechInfoWithCache(enterpriseId);
    
    if (result) {
      return {
        success: true,
        truckNo: result.techInfo.truckNo?.trim() || undefined,
        techInfo: result.techInfo,
        source: result.source,
        cacheAge: result.cacheAge,
      };
    }
    
    return {
      success: false,
      error: 'Unable to retrieve tech info from API or cache',
    };
  }

  async lookupByTruckNumber(truckNumber: string): Promise<{ success: boolean; data?: TechInfoResponse; message?: string; source?: 'live' | 'cached' }> {
    const cleanTruckNo = truckNumber.trim();
    console.log(`[TPMS] Looking up tech by truck number: ${cleanTruckNo}`);
    
    try {
      // Try live API first
      const techInfo = await this.getTechInfo(cleanTruckNo);
      
      // Cache the successful response
      await this.cacheTPMSResponse(cleanTruckNo, 'truck_number', techInfo);
      
      console.log(`[TPMS] Tech found for truck ${cleanTruckNo}: ${techInfo.firstName} ${techInfo.lastName}`);
      return {
        success: true,
        data: techInfo,
        source: 'live',
      };
    } catch (error: any) {
      console.warn(`[TPMS-Cache] API failed for truck ${cleanTruckNo}, checking cache...`);
      
      // Try cached data
      const cached = await this.getCachedByTruckNo(cleanTruckNo);
      if (cached) {
        console.log(`[TPMS-Cache] Returning cached data for truck ${cleanTruckNo}`);
        return {
          success: true,
          data: cached.techInfo,
          source: 'cached',
        };
      }
      
      return {
        success: false,
        message: `No Employee found for ${cleanTruckNo}`,
      };
    }
  }

  // Batch lookup for multiple truck numbers - uses cache primarily to avoid rate limiting
  async batchLookupByTruckNumbers(truckNumbers: string[]): Promise<Map<string, CachedTechInfo | null>> {
    const results = new Map<string, CachedTechInfo | null>();
    
    // First, get all cached data
    const allCached = await storage.getAllTpmsCachedAssignments();
    const cacheByTruck = new Map<string, typeof allCached[0]>();
    
    for (const cached of allCached) {
      if (cached.truckNo) {
        const raw = cached.truckNo;
        const stripped = raw.replace(/^0+/, '');
        const padded = stripped.padStart(6, '0');
        cacheByTruck.set(raw, cached);
        if (!cacheByTruck.has(stripped)) cacheByTruck.set(stripped, cached);
        if (!cacheByTruck.has(padded)) cacheByTruck.set(padded, cached);
      }
    }
    
    // For each truck number, return cached data if available
    for (const truckNo of truckNumbers) {
      const cached = cacheByTruck.get(truckNo);
      
      if (cached && cached.rawResponse) {
        try {
          const techInfo: TechInfoResponse = JSON.parse(cached.rawResponse);
          const cacheAge = cached.lastSuccessAt 
            ? Math.round((Date.now() - new Date(cached.lastSuccessAt).getTime()) / (1000 * 60 * 60))
            : undefined;
          
          results.set(truckNo, {
            techInfo,
            source: 'cached',
            cacheAge,
          });
        } catch {
          results.set(truckNo, null);
        }
      } else {
        results.set(truckNo, null);
      }
    }
    
    return results;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      if (!this.authEndpoint || !this.basicAuthCredential || !this.apiEndpoint) {
        return {
          success: false,
          message: 'TPMS is not fully configured. Please set TPMS_AUTH_ENDPOINT, TPMS_API_ENDPOINT, and TPMS_AUTHORIZATION.',
        };
      }

      await this.getToken();
      
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

  // Get cache statistics
  async getCacheStats(): Promise<{ total: number; live: number; cached: number; error: number; stale: number }> {
    const allCached = await storage.getAllTpmsCachedAssignments();
    const stale = await storage.getStaleTPMSCache(24);
    
    return {
      total: allCached.length,
      live: allCached.filter(c => c.status === 'live').length,
      cached: allCached.filter(c => c.status === 'cached').length,
      error: allCached.filter(c => c.status === 'error').length,
      stale: stale.length,
    };
  }

  // Run initial sync - processes all vehicles and caches TPMS assignments
  async runInitialSync(truckNumbers: string[], onProgress?: (synced: number, total: number, withAssignments: number) => void): Promise<{ success: boolean; synced: number; withAssignments: number; withoutAssignments: number; errors: number }> {
    console.log(`[TPMS-InitialSync] Starting initial sync for ${truckNumbers.length} vehicles`);
    
    await storage.updateTpmsSyncState({
      status: 'syncing',
      totalVehiclesToSync: truckNumbers.length,
      vehiclesSynced: 0,
      vehiclesWithAssignments: 0,
      vehiclesWithoutAssignments: 0,
      initialSyncStartedAt: new Date(),
      errorMessage: null,
    });

    let synced = 0;
    let withAssignments = 0;
    let withoutAssignments = 0;
    let errors = 0;

    // Process in batches with delay to avoid rate limiting
    const batchSize = 5;
    const delayBetweenBatches = 1000; // 1 second between batches

    for (let i = 0; i < truckNumbers.length; i += batchSize) {
      const batch = truckNumbers.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (truckNo) => {
        try {
          const result = await this.lookupByTruckNumber(truckNo);
          synced++;
          
          if (result.success && result.data?.ldapId) {
            withAssignments++;
          } else {
            withoutAssignments++;
          }
        } catch (error) {
          console.error(`[TPMS-InitialSync] Error syncing ${truckNo}:`, error);
          errors++;
          synced++;
        }
      }));

      // Update progress
      await storage.updateTpmsSyncState({
        vehiclesSynced: synced,
        vehiclesWithAssignments: withAssignments,
        vehiclesWithoutAssignments: withoutAssignments,
      });

      if (onProgress) {
        onProgress(synced, truckNumbers.length, withAssignments);
      }

      // Log progress every 50 vehicles
      if (synced % 50 === 0 || synced === truckNumbers.length) {
        console.log(`[TPMS-InitialSync] Progress: ${synced}/${truckNumbers.length} (${withAssignments} with assignments)`);
      }

      // Add delay between batches (except for the last one)
      if (i + batchSize < truckNumbers.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    // Mark sync complete
    await storage.updateTpmsSyncState({
      status: 'completed',
      initialSyncComplete: true,
      initialSyncCompletedAt: new Date(),
      lastSyncAt: new Date(),
      vehiclesSynced: synced,
      vehiclesWithAssignments: withAssignments,
      vehiclesWithoutAssignments: withoutAssignments,
    });

    console.log(`[TPMS-InitialSync] Complete: ${synced} synced, ${withAssignments} with assignments, ${errors} errors`);

    return { success: true, synced, withAssignments, withoutAssignments, errors };
  }

  // Get sync state
  async getSyncState(): Promise<{ initialSyncComplete: boolean; status: string; vehiclesSynced: number; totalVehiclesToSync: number; vehiclesWithAssignments: number; lastSyncAt: Date | null } | null> {
    return storage.getTpmsSyncState();
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

export type { TechInfoResponse, TechAddress };
