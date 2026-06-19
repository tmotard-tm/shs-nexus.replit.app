import { storage } from './storage';
import type { InsertTpmsCachedAssignment } from '@shared/schema';
import { toCanonical, normalizeEnterpriseId } from './vehicle-number-utils';
import { db } from './db';
import { sql } from 'drizzle-orm';
import { tpmsTechProfiles, tpmsLastKnownTruckTech } from '@shared/schema';

interface TPMSToken {
  token: string;
  expiresAt: number;
}

interface TechInfoResponse {
  correlationId?: string;
  messages?: string[];
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

interface TPMSApiResponse {
  correlationId: string;
  messages: string[];
  messagesAsSet: string[];
  techInfoList: TechInfoResponse[];
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

    const raw: TPMSApiResponse = await response.json();

    if (raw.messages && !raw.messages.includes('SUCCESS')) {
      throw new Error(`TPMS error: ${raw.messages.join(', ')}`);
    }

    const entry = raw.techInfoList?.[0];
    if (!entry) {
      throw new Error('TPMS returned no tech info entries');
    }

    // Trim trailing whitespace that TPMS includes in string fields
    const data: TechInfoResponse = {
      ...entry,
      correlationId: raw.correlationId,
      messages: raw.messages,
      ldapId: entry.ldapId?.trim() ?? entry.ldapId,
      truckNo: entry.truckNo?.trim() ?? entry.truckNo,
      techManagerLdapId: entry.techManagerLdapId?.trim() ?? entry.techManagerLdapId,
    };

    console.log(`[TPMS] Tech info retrieved successfully for ${cleanId}, Truck: ${data.truckNo || 'N/A'}`);
    return data;
  }

  // Cache a successful TPMS response
  private async cacheTPMSResponse(lookupKey: string, lookupType: 'enterprise_id' | 'truck_number', techInfo: TechInfoResponse): Promise<void> {
    try {
      const cacheData: InsertTpmsCachedAssignment = {
        lookupKey: normalizeEnterpriseId(lookupKey),
        lookupType,
        truckNo: techInfo.truckNo?.trim() || null,
        enterpriseId: normalizeEnterpriseId(techInfo.ldapId || ''),
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
    const normalizedId = normalizeEnterpriseId(enterpriseId);
    
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
      
      const existingCache = await storage.getTpmsCachedAssignment(normalizedId);
      if (existingCache) {
        await storage.markTpmsCacheError(normalizedId, statusCode, error.message);
      }
      
      let cached = await storage.getTpmsCachedAssignment(normalizedId);
      if (!cached) {
        cached = await storage.getTpmsCachedAssignmentByEnterpriseId(normalizedId);
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

  // [T007 DEPRECATED] Legacy reader of tpms_cached_assignments. No longer called —
  // lookupByTruckNumber now reads tpms_tech_profiles via getTruckTechFromProfiles().
  // Kept temporarily; remove in the T007 phase-3 schema cleanup once writers are retired.
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

  // [T007 migration] Truck→tech lookups resolve against tpms_tech_profiles (the FRESH TPMS
  // roster synced in prod every few hours), with a guarded fallback to tpms_last_known_truck_tech
  // (persists the last tech seen on a truck even after it drops off the live roster). The legacy
  // tpms_cached_assignments path (getCachedByTruckNo) is retired here — its prod refresh is
  // disabled and went stale. Matching is CANONICAL (toCanonical = trim + strip leading zeros) so
  // padded/unpadded numbers align. The TPMS API itself has no truck-number lookup endpoint
  // (/techinfo/{id} only accepts an LDAP/Enterprise ID), so this remains a local-roster read.
  private async getTruckTechFromProfiles(truckNo: string): Promise<CachedTechInfo | null> {
    const canon = toCanonical(truckNo);
    if (!canon) return null;

    // Tier 1: live-synced tech roster; most-recently-updated row wins.
    const [profile] = await db
      .select({
        enterpriseId: tpmsTechProfiles.enterpriseId,
        techId: tpmsTechProfiles.techId,
        firstName: tpmsTechProfiles.firstName,
        lastName: tpmsTechProfiles.lastName,
        districtNo: tpmsTechProfiles.districtNo,
        techManagerLdapId: tpmsTechProfiles.techManagerLdapId,
        mobilePhone: tpmsTechProfiles.mobilePhone,
        email: tpmsTechProfiles.email,
        truckNo: tpmsTechProfiles.truckNo,
        updatedAt: tpmsTechProfiles.updatedAt,
      })
      .from(tpmsTechProfiles)
      .where(sql`ltrim(trim(${tpmsTechProfiles.truckNo}), '0') = ${canon}`)
      .orderBy(sql`${tpmsTechProfiles.updatedAt} desc nulls last`)
      .limit(1);

    if (profile && profile.enterpriseId) {
      const cacheAge = profile.updatedAt
        ? Math.round((Date.now() - new Date(profile.updatedAt).getTime()) / (1000 * 60 * 60))
        : undefined;
      return {
        techInfo: {
          ldapId: profile.enterpriseId,
          firstName: profile.firstName || '',
          lastName: profile.lastName || '',
          techId: profile.techId || '',
          districtNo: profile.districtNo || '',
          techManagerLdapId: profile.techManagerLdapId || '',
          truckNo: profile.truckNo || '',
          contactNo: profile.mobilePhone || undefined,
          email: profile.email || undefined,
        },
        source: 'cached',
        cacheAge,
      };
    }

    // Tier 2 (guarded fallback): last-known tech for this truck; most-recently-seen row wins.
    const [lastKnown] = await db
      .select()
      .from(tpmsLastKnownTruckTech)
      .where(sql`ltrim(trim(${tpmsLastKnownTruckTech.truckNo}), '0') = ${canon}`)
      .orderBy(sql`${tpmsLastKnownTruckTech.lastSeenAt} desc nulls last`)
      .limit(1);

    if (lastKnown && lastKnown.enterpriseId) {
      const cacheAge = lastKnown.lastSeenAt
        ? Math.round((Date.now() - new Date(lastKnown.lastSeenAt).getTime()) / (1000 * 60 * 60))
        : undefined;
      return {
        techInfo: {
          ldapId: lastKnown.enterpriseId,
          firstName: lastKnown.firstName || '',
          lastName: lastKnown.lastName || '',
          techId: lastKnown.techId || '',
          districtNo: lastKnown.districtNo || '',
          techManagerLdapId: '',
          truckNo: lastKnown.truckNo || '',
          contactNo: lastKnown.mobilePhone || undefined,
          email: lastKnown.email || undefined,
        },
        source: 'cached',
        cacheAge,
      };
    }

    return null;
  }

  async lookupByTruckNumber(truckNumber: string): Promise<{ success: boolean; data?: TechInfoResponse; message?: string; source?: 'live' | 'cached' }> {
    const cleanTruckNo = truckNumber.trim();
    console.log(`[TPMS] Looking up tech by truck number (tpms_tech_profiles): ${cleanTruckNo}`);

    const cached = await this.getTruckTechFromProfiles(cleanTruckNo);
    if (cached) {
      return {
        success: true,
        data: cached.techInfo,
        source: 'cached',
      };
    }

    return {
      success: false,
      message: `No tech profile found for truck ${cleanTruckNo}. The TPMS API does not support truck-number lookup — populate the roster via Enterprise ID first.`,
    };
  }

  // Batch lookup for multiple truck numbers - uses cache primarily to avoid rate limiting
  async batchLookupByTruckNumbers(truckNumbers: string[]): Promise<Map<string, CachedTechInfo | null>> {
    const results = new Map<string, CachedTechInfo | null>();

    // Source: tpms_tech_profiles — the FRESH TPMS roster synced in prod every few hours,
    // NOT the legacy tpms_cached_assignments cache (its prod refresh is dev-only/disabled
    // and goes stale; that staleness caused the BYOV "Unassigned in TPMS" false positives
    // and the cross-truck search ghost). Keyed by CANONICAL truck number so padded/unpadded
    // numbers match; most-recently-synced row wins. The results map stays keyed by the
    // caller's original input string so callers resolve by whatever variation they passed.
    const rows = await db
      .select({
        truckNo: tpmsTechProfiles.truckNo,
        enterpriseId: tpmsTechProfiles.enterpriseId,
        firstName: tpmsTechProfiles.firstName,
        lastName: tpmsTechProfiles.lastName,
        districtNo: tpmsTechProfiles.districtNo,
        updatedAt: tpmsTechProfiles.updatedAt,
      })
      .from(tpmsTechProfiles);

    const byCanonical = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const canon = toCanonical(row.truckNo || '');
      if (!canon) continue;
      const existing = byCanonical.get(canon);
      if (!existing || (row.updatedAt && (!existing.updatedAt || new Date(row.updatedAt) > new Date(existing.updatedAt)))) {
        byCanonical.set(canon, row);
      }
    }

    for (const truckNo of truckNumbers) {
      const row = byCanonical.get(toCanonical(truckNo));
      if (row && row.enterpriseId) {
        results.set(truckNo, {
          techInfo: {
            ldapId: row.enterpriseId,
            firstName: row.firstName || '',
            lastName: row.lastName || '',
            techId: '',
            districtNo: row.districtNo || '',
            techManagerLdapId: '',
            truckNo: row.truckNo || '',
          },
          source: 'cached',
        });
      } else {
        results.set(truckNo, null);
      }
    }

    return results;
  }

  // Get all techs updated after a given timestamp (ISO 8601 format)
  async getTechsUpdatedAfter(timestamp: string): Promise<any> {
    const token = await this.getToken();
    const baseUrl = this.apiEndpoint.endsWith('/') ? this.apiEndpoint.slice(0, -1) : this.apiEndpoint;
    const encoded = encodeURIComponent(timestamp);
    const url = `${baseUrl}/techsupdatedafter/${encoded}`;
    console.log(`[TPMS] Fetching techs updated after: ${timestamp}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`techsupdatedafter request failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`[TPMS] techsupdatedafter returned successfully`);
    return data;
  }

  // Update a tech info record (PUT /techinfo)
  async updateTechInfo(body: Record<string, any>): Promise<any> {
    // TPMS PUT /techinfo is a batch API.
    // Body format: { "upserts": [{ "ldapId": "AARNOLD", "truckNo": "", ... }] }
    // ldapId belongs INSIDE the upserts array entry, not at the top level.
    const { ldapId, ...rest } = body;
    if (!ldapId) throw new Error('updateTechInfo requires ldapId');
    const cleanLdapId = String(ldapId).trim().toUpperCase();

    const token = await this.getToken();
    const baseUrl = this.apiEndpoint.endsWith('/') ? this.apiEndpoint.slice(0, -1) : this.apiEndpoint;
    const url = `${baseUrl}/techinfo`;
    console.log(`[TPMS] Updating tech info for: ${cleanLdapId}`);

    // TPMS PUT /techinfo body (per Postman collection):
    //   { "techLdapId": "KMICKEL", "upserts": { "truckNo": "046863", "updatedBy": "TMOTARD" } }
    const requestBody = { techLdapId: cleanLdapId, upserts: rest };
    const bodyStr = JSON.stringify(requestBody);
    console.log(`[TPMS] PUT ${url} body: ${bodyStr}`);

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: bodyStr,
    });

    const rawText = await response.text();
    console.log(`[TPMS] PUT response: ${response.status} ${rawText}`);

    if (!response.ok) {
      throw new Error(`Tech update request failed: ${response.status} - ${rawText}`);
    }

    let data: any;
    try { data = JSON.parse(rawText); } catch { data = rawText; }

    // Only throw if messages is non-empty and doesn't contain SUCCESS.
    // A successful PUT returns messages:[] (empty), updateSuccess:[...], failedUpdates:[].
    // Also throw if failedUpdates is non-empty regardless of messages.
    if (data?.failedUpdates && Array.isArray(data.failedUpdates) && data.failedUpdates.length > 0) {
      throw new Error(`TPMS rejected update: ${data.failedUpdates.map((f: any) => typeof f === 'string' ? f : JSON.stringify(f)).join(', ')}`);
    }
    if (data?.messages && Array.isArray(data.messages) && data.messages.length > 0 && !data.messages.includes('SUCCESS')) {
      throw new Error(`TPMS rejected update: ${data.messages.map((m: any) => typeof m === 'string' ? m : JSON.stringify(m)).join(', ')}`);
    }

    console.log(`[TPMS] Tech info updated successfully for ${cleanLdapId}`);
    return data;
  }

  // Add a truck to TPMS (POST /addtruck)
  // Body per Postman collection:
  //   { "truckNo": "088274", "truckName": "2019 FORD F-150", "regionNo": "0000890",
  //     "distNo": "0007088", "spareTruck": true, "updatedBy": "NEXUS" }
  async addTruck(params: {
    truckNo: string;
    truckName: string;
    regionNo: string;
    distNo: string;
    spareTruck?: boolean;
    updatedBy: string;
  }): Promise<any> {
    const token = await this.getToken();
    const baseUrl = this.apiEndpoint.endsWith('/') ? this.apiEndpoint.slice(0, -1) : this.apiEndpoint;
    const url = `${baseUrl}/addtruck`;

    const requestBody = {
      truckNo: params.truckNo,
      truckName: params.truckName,
      regionNo: params.regionNo,
      distNo: params.distNo,
      spareTruck: params.spareTruck ?? true,
      updatedBy: params.updatedBy,
    };
    const bodyStr = JSON.stringify(requestBody);
    console.log(`[TPMS] POST ${url} body: ${bodyStr}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: bodyStr,
    });

    const rawText = await response.text();
    console.log(`[TPMS] addtruck response: ${response.status} ${rawText}`);

    if (!response.ok) {
      throw new Error(`Add truck request failed: ${response.status} - ${rawText}`);
    }

    let data: any;
    try { data = JSON.parse(rawText); } catch { data = rawText; }
    console.log(`[TPMS] Truck added successfully: ${params.truckNo}`);
    return data;
  }

  // Update a truck's district in TPMS (POST /updatetruckdist)
  // Body per Postman collection:
  //   { "truckNo": "061765", "distNo": "0006141", "updatedBy": "NEXUS" }
  // Note: TPMS rejects a district change while the truck is assigned to a tech,
  // so callers must confirm the vehicle is unassigned before invoking this.
  async updateTruckDist(params: {
    truckNo: string;
    distNo: string;
    updatedBy: string;
  }): Promise<any> {
    const token = await this.getToken();
    const baseUrl = this.apiEndpoint.endsWith('/') ? this.apiEndpoint.slice(0, -1) : this.apiEndpoint;
    const url = `${baseUrl}/updatetruckdist`;

    const requestBody = {
      truckNo: params.truckNo,
      distNo: params.distNo,
      updatedBy: params.updatedBy,
    };
    const bodyStr = JSON.stringify(requestBody);
    console.log(`[TPMS] POST ${url} body: ${bodyStr}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: bodyStr,
    });

    const rawText = await response.text();
    console.log(`[TPMS] updatetruckdist response: ${response.status} ${rawText}`);

    if (!response.ok) {
      throw new Error(`Update truck district request failed: ${response.status} - ${rawText}`);
    }

    let data: any;
    try { data = JSON.parse(rawText); } catch { data = rawText; }
    console.log(`[TPMS] Truck district updated successfully: ${params.truckNo} → ${params.distNo}`);
    return data;
  }

  // Temporary truck assignment (POST /temptruckassign)
  async tempTruckAssign(ldapId: string, distNo: string, truckNo: string): Promise<any> {
    const token = await this.getToken();
    const baseUrl = this.apiEndpoint.endsWith('/') ? this.apiEndpoint.slice(0, -1) : this.apiEndpoint;
    const url = `${baseUrl}/temptruckassign`;
    console.log(`[TPMS] Temp truck assign: ldapId=${ldapId}, distNo=${distNo}, truckNo=${truckNo}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ ldapId, distNo, truckNo }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Temp truck assign request failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`[TPMS] Temp truck assign successful: ${ldapId} → truck ${truckNo}`);
    return data;
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
