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

export interface SegnoEvent {
  id: string;
  name: string | null;
  event_code: string | null;
  activity_status_type: string | null;
  due_date: string | null;
  date_entered: string | null;
  description: string | null;
  [key: string]: any;
}

export interface SegnoAssetOrder {
  id: string;
  name: string | null;
  date_entered: string | null;
  description: string | null;
  [key: string]: any;
}

export interface SegnoUser {
  id: string;
  user_name: string | null;
  name: string | null;
  date_entered: string | null;
  [key: string]: any;
}

const ONBOARDING_SELECT_FIELDS = [
  "id", "name", "district", "first_name", "last_name", "job_code",
  "employee_id", "enterprise_id", "tech_id", "type_of_hire",
  "start_date", "proposed_route_start_date", "date_entered",
];

const EVENT_SELECT_FIELDS = [
  "id", "name", "event_code", "activity_status_type", "due_date", "date_entered", "description",
];

const ASSET_ORDER_SELECT_FIELDS = [
  "id", "name", "date_entered", "description",
];

const USER_SELECT_FIELDS = [
  "id", "user_name", "name", "date_entered",
];

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

function parseEntryList(data: any): Record<string, any>[] {
  if (!data || !data.entry_list) return [];
  return data.entry_list.map((entry: any) => {
    const record: Record<string, any> = { id: entry.id };
    if (entry.name_value_list) {
      for (const [key, val] of Object.entries(entry.name_value_list as Record<string, any>)) {
        record[key] = val?.value ?? null;
      }
    }
    return record;
  });
}

function parseEntry(data: any): Record<string, any> | null {
  if (!data || !data.entry) return null;
  const record: Record<string, any> = { id: data.entry.id };
  if (data.entry.name_value_list) {
    for (const [key, val] of Object.entries(data.entry.name_value_list as Record<string, any>)) {
      record[key] = val?.value ?? null;
    }
  }
  return record;
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
      application_name: "Segno_Workflow_API",
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

  // ─── Generic module helpers ────────────────────────────────────────────────

  private async listModule(module: string, selectFields: string[], options: {
    query?: string; orderBy?: string; offset?: number; maxResults?: number;
  } = {}): Promise<{ records: Record<string, any>[]; totalCount: number; nextOffset: number }> {
    const data = await this.callMethod("get_entry_list", {
      module_name: module,
      query: options.query || "",
      order_by: options.orderBy ?? "date_entered DESC",
      offset: options.offset ?? 0,
      select_fields: selectFields,
      max_results: options.maxResults ?? 50,
      deleted: 0,
    });
    const records = parseEntryList(data);
    return { records, totalCount: data.result_count ?? records.length, nextOffset: data.next_offset ?? 0 };
  }

  private async getModuleEntry(module: string, id: string): Promise<Record<string, any> | null> {
    const data = await this.callMethod("get_entry", {
      module_name: module,
      id,
      select_fields: [],
      link_name_to_fields_array: [],
    });
    return parseEntry(data);
  }

  private async setModuleEntry(module: string, fields: Record<string, any>): Promise<{ id: string }> {
    const data = await this.callMethod("set_entry", {
      module_name: module,
      name_value_list: fields,
    });
    if (!data.id) throw new Error(`Failed to set ${module} record: ` + JSON.stringify(data));
    return { id: data.id };
  }

  private async deleteModuleEntry(module: string, id: string): Promise<{ id: string }> {
    return this.setModuleEntry(module, { id, deleted: 1 });
  }

  // ─── Connection ────────────────────────────────────────────────────────────

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
      await this.authenticate();
      return { configured: true, message: "Connected to Segno" };
    } catch (error: any) {
      return { configured: false, message: error.message };
    }
  }

  // ─── OnBoarding ────────────────────────────────────────────────────────────

  async getOnboardingList(options: { query?: string; offset?: number; maxResults?: number } = {}) {
    return this.listModule("OnBoarding", ONBOARDING_SELECT_FIELDS, {
      query: options.query,
      orderBy: "date_entered DESC",
      offset: options.offset,
      maxResults: options.maxResults ?? 100,
    });
  }

  async getOnboardingById(id: string) {
    return this.getModuleEntry("OnBoarding", id) as Promise<SegnoOnboardingRecord | null>;
  }

  async searchOnboardingByEmployeeId(employeeId: string) {
    const safe = employeeId.replace(/'/g, "''");
    const result = await this.listModule("OnBoarding", ONBOARDING_SELECT_FIELDS, {
      query: `onboarding_cstm.employee_id_c='${safe}'`,
      maxResults: 10,
    });
    return result.records as SegnoOnboardingRecord[];
  }

  async searchOnboardingByEnterpriseId(enterpriseId: string) {
    const safe = enterpriseId.replace(/'/g, "''");
    const result = await this.listModule("OnBoarding", ONBOARDING_SELECT_FIELDS, {
      query: `onboarding_cstm.enterprise_id_c='${safe}'`,
      maxResults: 10,
    });
    return result.records as SegnoOnboardingRecord[];
  }

  async searchOnboarding(query: string) {
    const safe = query.replace(/'/g, "''");
    const result = await this.listModule("OnBoarding", ONBOARDING_SELECT_FIELDS, {
      query: `onboarding.name LIKE '%${safe}%' OR onboarding_cstm.employee_id_c LIKE '%${safe}%' OR onboarding_cstm.enterprise_id_c LIKE '%${safe}%'`,
      maxResults: 50,
    });
    return result.records as SegnoOnboardingRecord[];
  }

  async createOnboardingRecord(fields: Record<string, any>) {
    return this.setModuleEntry("OnBoarding", fields);
  }

  async updateOnboardingRecord(id: string, fields: Record<string, any>) {
    return this.setModuleEntry("OnBoarding", { id, ...fields });
  }

  async deleteOnboardingRecord(id: string) {
    return this.deleteModuleEntry("OnBoarding", id);
  }

  // ─── FP_events ─────────────────────────────────────────────────────────────

  async getEventsList(options: { query?: string; offset?: number; maxResults?: number } = {}) {
    return this.listModule("FP_events", EVENT_SELECT_FIELDS, {
      query: options.query,
      orderBy: "date_entered DESC",
      offset: options.offset,
      maxResults: options.maxResults ?? 50,
    });
  }

  async getEventsById(id: string) {
    return this.getModuleEntry("FP_events", id) as Promise<SegnoEvent | null>;
  }

  async searchEvents(query: string, status?: string) {
    const safe = query.replace(/'/g, "''");
    const parts: string[] = [];
    if (query.trim()) {
      parts.push(`fp_events.name LIKE '%${safe}%'`);
    }
    if (status) {
      parts.push(`activity_status_type='${status.replace(/'/g, "''")}'`);
    }
    const result = await this.listModule("FP_events", EVENT_SELECT_FIELDS, {
      query: parts.join(" AND "),
      maxResults: 50,
    });
    return result.records as SegnoEvent[];
  }

  async getEventsByStatus(status: string) {
    const result = await this.listModule("FP_events", EVENT_SELECT_FIELDS, {
      query: `activity_status_type='${status.replace(/'/g, "''")}'`,
      maxResults: 100,
    });
    return result.records as SegnoEvent[];
  }

  async createEvent(fields: Record<string, any>) {
    return this.setModuleEntry("FP_events", fields);
  }

  async updateEvent(id: string, fields: Record<string, any>) {
    return this.setModuleEntry("FP_events", { id, ...fields });
  }

  async deleteEvent(id: string) {
    return this.deleteModuleEntry("FP_events", id);
  }

  // ─── Asset_Order ───────────────────────────────────────────────────────────

  async getAssetOrdersList(options: { query?: string; offset?: number; maxResults?: number } = {}) {
    return this.listModule("Asset_Order", ASSET_ORDER_SELECT_FIELDS, {
      query: options.query,
      orderBy: "date_entered DESC",
      offset: options.offset,
      maxResults: options.maxResults ?? 50,
    });
  }

  async getAssetOrderById(id: string) {
    return this.getModuleEntry("Asset_Order", id) as Promise<SegnoAssetOrder | null>;
  }

  async searchAssetOrders(query: string) {
    const safe = query.replace(/'/g, "''");
    const result = await this.listModule("Asset_Order", ASSET_ORDER_SELECT_FIELDS, {
      query: `name LIKE '%${safe}%'`,
      maxResults: 50,
    });
    return result.records as SegnoAssetOrder[];
  }

  async createAssetOrder(fields: Record<string, any>) {
    return this.setModuleEntry("Asset_Order", fields);
  }

  async updateAssetOrder(id: string, fields: Record<string, any>) {
    return this.setModuleEntry("Asset_Order", { id, ...fields });
  }

  async deleteAssetOrder(id: string) {
    return this.deleteModuleEntry("Asset_Order", id);
  }

  // ─── Users ─────────────────────────────────────────────────────────────────

  async getUsersList(options: { query?: string; offset?: number; maxResults?: number } = {}) {
    return this.listModule("Users", USER_SELECT_FIELDS, {
      query: options.query,
      orderBy: "date_entered DESC",
      offset: options.offset,
      maxResults: options.maxResults ?? 50,
    });
  }

  async getUserById(id: string) {
    return this.getModuleEntry("Users", id) as Promise<SegnoUser | null>;
  }

  async searchUsers(query: string) {
    const safe = query.replace(/'/g, "''");
    const result = await this.listModule("Users", USER_SELECT_FIELDS, {
      query: `users.first_name LIKE '%${safe}%' OR users.last_name LIKE '%${safe}%' OR users.user_name LIKE '%${safe}%'`,
      maxResults: 25,
    });
    return result.records as SegnoUser[];
  }
}

export const segnoApiService = new SegnoApiService();
