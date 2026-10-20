import { createSign } from 'node:crypto';

/**
 * The only thing the Sheets adapter needs from Google: read a tab, append a row, overwrite a row.
 * A fake (below) runs the contract suite and local demos with no Google account; the real client
 * talks to the Sheets REST API with a service account.
 */
export const TABS = {
  Patients: ['id', 'name', 'phone', 'dob'],
  Appointments: [
    'id',
    'patient_id',
    'resource_id',
    'service_id',
    'start',
    'end',
    'status',
    'source',
    'updated_at',
  ],
  Idempotency: ['key', 'operation', 'request_hash', 'response_json'],
} as const;
export type Tab = keyof typeof TABS;

export interface SheetsClient {
  /** Creates missing headers, so a blank spreadsheet is a usable clinic. */
  ensureHeaders(): Promise<void>;
  /** Every data row of a tab (header excluded). Short rows are padded to the header width. */
  readRows(tab: Tab): Promise<string[][]>;
  appendRow(tab: Tab, row: string[]): Promise<void>;
  /** Overwrites data row `index` (0-based, header excluded). */
  updateRow(tab: Tab, index: number, row: string[]): Promise<void>;
}

const pad = (row: string[], width: number): string[] =>
  Array.from({ length: width }, (_, i) => row[i] ?? '');

/** In-memory spreadsheet. Calls are async with a tiny random delay so races are real, not hidden. */
export class FakeSheetsClient implements SheetsClient {
  private readonly data = new Map<Tab, string[][]>();

  constructor(private readonly maxDelayMs = 2) {}

  private async tick(): Promise<void> {
    await new Promise((r) => setTimeout(r, Math.random() * this.maxDelayMs));
  }

  async ensureHeaders(): Promise<void> {
    await this.tick();
    for (const tab of Object.keys(TABS) as Tab[]) if (!this.data.has(tab)) this.data.set(tab, []);
  }

  async readRows(tab: Tab): Promise<string[][]> {
    await this.tick();
    return (this.data.get(tab) ?? []).map((r) => pad(r, TABS[tab].length));
  }

  async appendRow(tab: Tab, row: string[]): Promise<void> {
    await this.tick();
    const rows = this.data.get(tab) ?? [];
    rows.push(pad(row, TABS[tab].length));
    this.data.set(tab, rows);
  }

  async updateRow(tab: Tab, index: number, row: string[]): Promise<void> {
    await this.tick();
    const rows = this.data.get(tab) ?? [];
    if (index < 0 || index >= rows.length) throw new Error(`no row ${index} in ${tab}`);
    rows[index] = pad(row, TABS[tab].length);
  }

  /** For tests: what a person editing the sheet by hand would add. */
  seed(tab: Tab, row: string[]): void {
    const rows = this.data.get(tab) ?? [];
    rows.push(pad(row, TABS[tab].length));
    this.data.set(tab, rows);
  }
}

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** Google Sheets over REST. Credentials: a service account the clinic shared the sheet with. */
export class GoogleSheetsClient implements SheetsClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly spreadsheetId: string,
    private readonly account: ServiceAccount,
    private readonly http: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const iat = Math.floor(this.now() / 1000);
    const claims = {
      iss: this.account.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
    };
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const unsigned = `${header}.${b64url(JSON.stringify(claims))}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.account.private_key);
    const res = await this.http(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${b64url(signature)}`,
      }),
    });
    if (!res.ok) throw new Error(`Google sign-in failed (${res.status})`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: this.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}`;
    const res = await this.http(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Sheets ${init.method ?? 'GET'} ${path} -> ${res.status}`);
    return (await res.json()) as T;
  }

  private lastColumn(tab: Tab): string {
    return String.fromCharCode(64 + TABS[tab].length); // A..I
  }

  async ensureHeaders(): Promise<void> {
    for (const tab of Object.keys(TABS) as Tab[]) {
      const last = this.lastColumn(tab);
      const have = await this.call<{ values?: string[][] }>(`/values/${tab}!A1:${last}1`);
      if (have.values?.[0]?.length) continue;
      await this.call(`/values/${tab}!A1:${last}1?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values: [[...TABS[tab]]] }),
      });
    }
  }

  async readRows(tab: Tab): Promise<string[][]> {
    const out = await this.call<{ values?: string[][] }>(
      `/values/${tab}!A2:${this.lastColumn(tab)}`,
    );
    return (out.values ?? []).map((r) => pad(r, TABS[tab].length));
  }

  async appendRow(tab: Tab, row: string[]): Promise<void> {
    const last = this.lastColumn(tab);
    await this.call(
      `/values/${tab}!A1:${last}1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: JSON.stringify({ values: [row] }) },
    );
  }

  async updateRow(tab: Tab, index: number, row: string[]): Promise<void> {
    const n = index + 2; // row 1 is the header
    await this.call(`/values/${tab}!A${n}:${this.lastColumn(tab)}${n}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [row] }),
    });
  }
}
