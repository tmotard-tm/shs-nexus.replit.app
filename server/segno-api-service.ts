import { createHash } from "crypto";

export interface SegnoOnboardingRecord {
  id: string;
  name: string;
  district: string | null;
  first_name: string | null;
  last_name: string | null;
  job_code: string | null;
  employee_id: string | null;
  enterprise_id: string | null;
  tech_id: string | null;
  type_of_hire: string | null;
  start_date: string | null;
  proposed_route_start_date: string | null;
  date_entered: string | null;
  [key: string]: any;
}

const ONBOARDING_SELECT_FIELDS = [
  "id", "name", "district", "first_name", "last_name", "job_code",
  "employee_id", "enterprise_id", "tech_id", "type_of_hire",
  "start_date", "proposed_route_start_date", "date_entered",
];

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

function parseEntryList(data: any): SegnoOnboardingRecord[] {
  if (!data || !data.entry_list) return [];
  return data.entry_list.map((entry: any) => {
    const record: Record<string, any> = { id: entry.id };
    if (entry.name_value_list) {
      for (const [key, val] of Object.entries(entry.name_value_list as Record<string, any>)) {
        record[key] = val?.value ?? null;
      }
    }
    return record as SegnoOnboardingRecord;
  });
}

function parseEntry(data: any): SegnoOnboardingRecord | null {
  if (!data || !data.entry) return null;
  const record: Record<string, any> = { id: data.entry.id };
  if (data.entry.name_value_list) {
    for (const [key, val] of Object.entries(data.entry.name_value_list as Record<string, any>)) {
      record[key] = val?.value ?? null;
    }
  }
  return record as SegnoOnboardingRecord;
}

class SegnoApiService {
  private baseUrl: string;
  private username: string;
  private password: string;
  private sessionId: string | null = null;
  private sessionExpiry: number = 0;

  constructor() {
    this.baseUrl = process.env.SEGNO_BASE_URL || "";
    this.username = process.env.SEGNO_USERNAME || "";
    this.password = process.env.SEGNO_PASSWORD || "";
  }

  get isConfigured(): boolean {
    return !!(this.baseUrl && this.username && this.password);
  }

  private async post(params: Record<string, string>): Promise<any> {
    if (!this.baseUrl) throw new Error("SEGNO_BASE_URL not configured");
    const body = new URLSearchParams(params);
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`Segno API error: ${res.status} ${res.statusText}`);
    return res.json();
  }

  private async authenticate(): Promise<string> {
    if (this.sessionId && Date.now() < this.sessionExpiry) {
      return this.sessionId;
    }
    console.log("[Segno] Authenticating...");
    const restData = JSON.stringify({
      user_auth: { user_name: this.username, password: md5(this.password) },
      application_name: "Nexus",
    });
    const data = await this.post({ method: "login", input_type: "JSON", response_type: "JSON", rest_data: restData });
    if (!data.id || data.name === "Invalid Login") {
      throw new Error(data.description || "Segno authentication failed");
    }
    this.sessionId = data.id;
    this.sessionExpiry = Date.now() + 55 * 60 * 1000;
    console.log("[Segno] Authenticated, session expires in 55 minutes");
    return data.id;
  }

  private async callMethod(method: string, restDataPayload: Record<string, any>): Promise<any> {
    const session = await this.authenticate();
    const restData = JSON.stringify({ session, ...restDataPayload });
    const data = await this.post({ method, input_type: "JSON", response_type: "JSON", rest_data: restData });
    if (data.name === "Invalid Session ID" || data.number === 11) {
      console.log("[Segno] Session expired, re-authenticating...");
      this.sessionId = null;
      this.sessionExpiry = 0;
      return this.callMethod(method, restDataPayload);
    }
    return data;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.isConfigured) {
      return { success: false, message: "Segno credentials not configured (SEGNO_BASE_URL, SEGNO_USERNAME, SEGNO_PASSWORD)" };
    }
    try {
      this.sessionId = null;
      this.sessionExpiry = 0;
      await this.authenticate();
      return { success: true, message: `Connected to Segno at ${this.baseUrl}` };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  async getStatus(): Promise<{ configured: boolean; message: string }> {
    if (!this.isConfigured) {
      return { configured: false, message: "Segno credentials not configured" };
    }
    try {
      const session = await this.authenticate();
      return { configured: true, message: "Connected to Segno" };
    } catch (error: any) {
      return { configured: false, message: error.message };
    }
  }

  async getOnboardingList(options: { query?: string; offset?: number; maxResults?: number } = {}): Promise<{ records: SegnoOnboardingRecord[]; totalCount: number; nextOffset: number }> {
    const data = await this.callMethod("get_entry_list", {
      module_name: "OnBoarding",
      query: options.query || "",
      order_by: "date_entered DESC",
      offset: options.offset ?? 0,
      select_fields: ONBOARDING_SELECT_FIELDS,
      max_results: options.maxResults ?? 100,
      deleted: 0,
    });
    const records = parseEntryList(data);
    return {
      records,
      totalCount: data.result_count ?? records.length,
      nextOffset: data.next_offset ?? 0,
    };
  }

  async getOnboardingById(id: string): Promise<SegnoOnboardingRecord | null> {
    const data = await this.callMethod("get_entry", {
      module_name: "OnBoarding",
      id,
      select_fields: [],
      link_name_to_fields_array: [],
    });
    return parseEntry(data);
  }

  async searchOnboardingByEmployeeId(employeeId: string): Promise<SegnoOnboardingRecord[]> {
    const data = await this.callMethod("get_entry_list", {
      module_name: "OnBoarding",
      query: `onboarding_cstm.employee_id_c='${employeeId.replace(/'/g, "''")}'`,
      order_by: "",
      offset: 0,
      select_fields: ONBOARDING_SELECT_FIELDS,
      max_results: 10,
      deleted: 0,
    });
    return parseEntryList(data);
  }

  async searchOnboardingByEnterpriseId(enterpriseId: string): Promise<SegnoOnboardingRecord[]> {
    const data = await this.callMethod("get_entry_list", {
      module_name: "OnBoarding",
      query: `onboarding_cstm.enterprise_id_c='${enterpriseId.replace(/'/g, "''")}'`,
      order_by: "",
      offset: 0,
      select_fields: ONBOARDING_SELECT_FIELDS,
      max_results: 10,
      deleted: 0,
    });
    return parseEntryList(data);
  }

  async searchOnboarding(query: string): Promise<SegnoOnboardingRecord[]> {
    const safe = query.replace(/'/g, "''");
    const searchQuery = `onboarding.name LIKE '%${safe}%' OR onboarding_cstm.employee_id_c LIKE '%${safe}%' OR onboarding_cstm.enterprise_id_c LIKE '%${safe}%'`;
    const data = await this.callMethod("get_entry_list", {
      module_name: "OnBoarding",
      query: searchQuery,
      order_by: "date_entered DESC",
      offset: 0,
      select_fields: ONBOARDING_SELECT_FIELDS,
      max_results: 50,
      deleted: 0,
    });
    return parseEntryList(data);
  }

  async createOnboardingRecord(fields: Record<string, any>): Promise<{ id: string }> {
    const nameValueList: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      nameValueList[k] = v;
    }
    const data = await this.callMethod("set_entry", {
      module_name: "OnBoarding",
      name_value_list: nameValueList,
    });
    if (!data.id) throw new Error("Failed to create record: " + JSON.stringify(data));
    return { id: data.id };
  }

  async updateOnboardingRecord(id: string, fields: Record<string, any>): Promise<{ id: string }> {
    const nameValueList: Record<string, any> = { id, ...fields };
    const data = await this.callMethod("set_entry", {
      module_name: "OnBoarding",
      name_value_list: nameValueList,
    });
    if (!data.id) throw new Error("Failed to update record: " + JSON.stringify(data));
    return { id: data.id };
  }
}

export const segnoApiService = new SegnoApiService();
