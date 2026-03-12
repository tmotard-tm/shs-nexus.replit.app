import { TrackingRecord } from "@shared/fleet-scope-schema";

const UPS_OAUTH_URL = "https://onlinetools.ups.com/security/v1/oauth/token";
const UPS_TRACKING_URL = "https://onlinetools.ups.com/api/track/v1/details";

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

// Rate limiting: track last refresh time per tracking number
const refreshRateLimits = new Map<string, number>();
const RATE_LIMIT_MS = 60000; // 1 minute between refreshes for the same tracking number

export function checkRateLimit(trackingNumber: string): { allowed: boolean; retryAfterMs?: number } {
  const lastRefresh = refreshRateLimits.get(trackingNumber);
  const now = Date.now();
  
  if (lastRefresh && now - lastRefresh < RATE_LIMIT_MS) {
    return { 
      allowed: false, 
      retryAfterMs: RATE_LIMIT_MS - (now - lastRefresh)
    };
  }
  
  refreshRateLimits.set(trackingNumber, now);
  return { allowed: true };
}

export interface UPSTrackingResult {
  status: string;
  statusDescription: string;
  location: string;
  estimatedDelivery: string | null;
  deliveredAt: Date | null;
  activities: Array<{
    status: string;
    description: string;
    location: string;
    timestamp: string;
  }>;
  error?: string;
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.FS_UPS_CLIENT_ID;
  const clientSecret = process.env.FS_UPS_API_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    throw new Error("UPS API credentials not configured. Please set UPS_CLIENT_ID and UPS_API_CLIENT_SECRET environment variables.");
  }
  
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) {
    return tokenCache.accessToken;
  }
  
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  
  try {
    const response = await fetch(UPS_OAUTH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${credentials}`,
      },
      body: "grant_type=client_credentials",
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("UPS OAuth error:", response.status, errorText);
      throw new Error(`UPS OAuth failed: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };
    
    return tokenCache.accessToken;
  } catch (error) {
    console.error("Error getting UPS access token:", error);
    throw error;
  }
}

export async function trackPackage(trackingNumber: string): Promise<UPSTrackingResult> {
  try {
    const accessToken = await getAccessToken();
    
    const requestBody = {
      trackingNumber: trackingNumber,
      locale: "en_US",
      returnSignature: false,
      returnMilestones: false,
      returnPOD: false,
    };
    
    const response = await fetch(`${UPS_TRACKING_URL}/${trackingNumber}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "transId": `track-${Date.now()}`,
        "transactionSrc": "FleetRepairTracker",
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("UPS Tracking error:", response.status, errorText);
      
      if (response.status === 404) {
        return {
          status: "NOT_FOUND",
          statusDescription: "Tracking number not found or not yet in UPS system",
          location: "",
          estimatedDelivery: null,
          deliveredAt: null,
          activities: [],
          error: "Tracking information not available. The package may not have been scanned yet.",
        };
      }
      
      throw new Error(`UPS Tracking failed: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    const shipment = data.trackResponse?.shipment?.[0];
    const pkg = shipment?.package?.[0];
    
    if (!pkg) {
      return {
        status: "NO_DATA",
        statusDescription: "No tracking data available",
        location: "",
        estimatedDelivery: null,
        deliveredAt: null,
        activities: [],
        error: "No package data returned from UPS",
      };
    }
    
    const currentStatus = pkg.currentStatus || {};
    const deliveryDate = pkg.deliveryDate?.[0];
    const deliveryTime = pkg.deliveryTime;
    
    let deliveredAt: Date | null = null;
    if (currentStatus.type === "D" && deliveryDate && deliveryTime) {
      try {
        deliveredAt = new Date(`${deliveryDate.date}T${deliveryTime.endTime || "12:00:00"}`);
      } catch (e) {
      }
    }
    
    const activities = (pkg.activity || []).map((activity: any) => ({
      status: activity.status?.type || "",
      description: activity.status?.description || "",
      location: formatLocation(activity.location),
      timestamp: formatTimestamp(activity.date, activity.time),
    }));
    
    const latestActivity = activities[0];
    
    return {
      status: currentStatus.type || latestActivity?.status || "UNKNOWN",
      statusDescription: currentStatus.description || latestActivity?.description || "Status unknown",
      location: formatLocation(pkg.location || latestActivity?.location),
      estimatedDelivery: formatEstimatedDelivery(deliveryDate),
      deliveredAt,
      activities,
    };
  } catch (error) {
    console.error("Error tracking UPS package:", error);
    throw error;
  }
}

function formatLocation(location: any): string {
  if (!location) return "";
  if (typeof location === "string") return location;
  
  const parts = [];
  if (location.address) {
    if (location.address.city) parts.push(location.address.city);
    if (location.address.stateProvince) parts.push(location.address.stateProvince);
    if (location.address.countryCode) parts.push(location.address.countryCode);
  } else {
    if (location.city) parts.push(location.city);
    if (location.stateProvince) parts.push(location.stateProvince);
    if (location.country || location.countryCode) parts.push(location.country || location.countryCode);
  }
  
  return parts.join(", ");
}

function formatTimestamp(date: string, time: string): string {
  if (!date) return "";
  try {
    const dateStr = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    const timeStr = time ? `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}` : "00:00:00";
    return new Date(`${dateStr}T${timeStr}`).toISOString();
  } catch (e) {
    return date;
  }
}

function formatEstimatedDelivery(deliveryDate: any): string | null {
  if (!deliveryDate) return null;
  try {
    const date = deliveryDate.date;
    if (!date) return null;
    const dateStr = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    return dateStr;
  } catch (e) {
    return null;
  }
}

export async function testUPSConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const accessToken = await getAccessToken();
    return {
      success: true,
      message: `UPS API connection successful. Token obtained.`,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `UPS API connection failed: ${error.message}`,
    };
  }
}
