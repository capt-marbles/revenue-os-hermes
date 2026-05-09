const TWENTY_API = process.env.TWENTY_API_URL ?? "https://api.twenty.com";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;

// ─── Error types ────────────────────────────────────────────────────────────

export class TwentyConfigError extends Error {
  constructor(message = "TWENTY_API_KEY not set") {
    super(message);
    this.name = "TwentyConfigError";
  }
}

export class TwentyApiError extends Error {
  status: number;
  details: string;

  constructor(status: number, details: string) {
    super(`Twenty API error ${status}: ${details}`);
    this.name = "TwentyApiError";
    this.status = status;
    this.details = details;
  }
}

// ─── Value types ─────────────────────────────────────────────────────────────

export interface TwentyPersonValues {
  firstName?: string;
  lastName?: string;
  email?: string;
  linkedinUrl?: string;
  jobTitle?: string;
  companyId?: string;
}

export interface TwentyCompanyValues {
  name: string;
  domainName?: string;
}

export interface TwentyOpportunityValues {
  name?: string;
  stage?: string;
  companyId?: string;
  pointOfContactId?: string;
  closeDate?: string;
}

// ─── Core fetch with retry + timeout ─────────────────────────────────────────

function getTwentyHeaders() {
  const key = process.env.TWENTY_API_KEY;
  if (!key) throw new TwentyConfigError();
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function twentyRequest<T>(path: string, init: RequestInit): Promise<T> {
  const url = `${TWENTY_API}${path}`;
  const headers = { ...getTwentyHeaders(), ...(init.headers ?? {}) };
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetchWithTimeout(url, { ...init, headers });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = new Error(`Twenty network error: ${msg}`);
      if (attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastError;
    }

    // Retry on 429 or 5xx
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("Retry-After") ?? 0);
      const wait = retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt);
      lastError = new TwentyApiError(response.status, await response.text());
      if (attempt < MAX_RETRIES) {
        await sleep(wait);
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      const details = await response.text();
      throw new TwentyApiError(response.status, details);
    }

    return response.json() as Promise<T>;
  }

  throw lastError ?? new Error("Twenty request failed after retries");
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Pagination ───────────────────────────────────────────────────────────────

interface TwentyPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

async function paginateAll<T>(resource: string, pageSize = 100): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | null = null;

  while (true) {
    const qs: string = cursor
      ? `limit=${pageSize}&order_by=createdAt[DescNullsLast]&starting_after=${encodeURIComponent(cursor)}`
      : `limit=${pageSize}&order_by=createdAt[DescNullsLast]`;

    const page = await twentyRequest<{ data?: Record<string, unknown> }>(
      `/rest/${resource}?${qs}`,
      { method: "GET" },
    );

    // Twenty REST: { data: { [resource]: [...], pageInfo: { ... } } }
    const records = page.data?.[resource];
    if (Array.isArray(records)) {
      results.push(...(records as T[]));
    }

    const pageInfo = page.data?.pageInfo as TwentyPageInfo | undefined;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    cursor = pageInfo.endCursor;
  }

  return results;
}

// ─── People ───────────────────────────────────────────────────────────────────

export async function queryTwentyPeople() {
  return paginateAll("people");
}

export async function findTwentyPersonByEmail(
  email: string,
): Promise<{ id: string } | null> {
  const encoded = encodeURIComponent(email);
  const res = await twentyRequest<{ data?: { people?: Array<{ id: string }> } }>(
    `/rest/people?filter=emails.primaryEmail[eq]:${encoded}&limit=1`,
    { method: "GET" },
  );
  return res.data?.people?.[0] ?? null;
}

function buildPersonBody(values: TwentyPersonValues): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (values.firstName !== undefined || values.lastName !== undefined) {
    body.name = {
      firstName: values.firstName ?? "",
      lastName: values.lastName ?? "",
    };
  }
  if (values.email) body.emails = { primaryEmail: values.email };
  if (values.linkedinUrl) {
    body.linkedinLink = {
      primaryLinkUrl: values.linkedinUrl,
      primaryLinkLabel: "",
    };
  }
  if (values.jobTitle) body.jobTitle = values.jobTitle;
  if (values.companyId) body.companyId = values.companyId;
  return body;
}

export async function createTwentyPerson(
  values: TwentyPersonValues,
): Promise<{ id: string }> {
  try {
    const res = await twentyRequest<{ data?: { createPerson?: { id: string } }; id?: string }>(
      "/rest/people",
      { method: "POST", body: JSON.stringify(buildPersonBody(values)) },
    );
    const id = res.data?.createPerson?.id ?? (res as { id?: string }).id;
    if (!id) throw new Error("Twenty createPerson returned no id");
    return { id };
  } catch (err) {
    // 409 = person already exists — fetch and return the existing record
    if (err instanceof TwentyApiError && err.status === 409 && values.email) {
      const existing = await findTwentyPersonByEmail(values.email);
      if (existing) return existing;
    }
    throw err;
  }
}

export async function updateTwentyPerson(
  personId: string,
  values: TwentyPersonValues,
): Promise<{ id: string }> {
  const res = await twentyRequest<{ data?: { updatePerson?: { id: string } }; id?: string }>(
    `/rest/people/${personId}`,
    { method: "PATCH", body: JSON.stringify(buildPersonBody(values)) },
  );
  const id = res.data?.updatePerson?.id ?? (res as { id?: string }).id ?? personId;
  return { id };
}

export async function upsertTwentyPerson(
  values: TwentyPersonValues,
): Promise<{ id: string }> {
  if (values.email) {
    const existing = await findTwentyPersonByEmail(values.email);
    if (existing) return updateTwentyPerson(existing.id, values);
  }
  return createTwentyPerson(values);
}

// ─── Companies ────────────────────────────────────────────────────────────────

export async function queryTwentyCompanies() {
  return paginateAll("companies");
}

export async function findTwentyCompanyByName(
  name: string,
): Promise<{ id: string } | null> {
  const encoded = encodeURIComponent(name);
  const res = await twentyRequest<{ data?: { companies?: Array<{ id: string }> } }>(
    `/rest/companies?filter=name[eq]:${encoded}&limit=1`,
    { method: "GET" },
  );
  return res.data?.companies?.[0] ?? null;
}

export async function createTwentyCompany(
  values: TwentyCompanyValues,
): Promise<{ id: string }> {
  const body: Record<string, unknown> = { name: values.name };
  if (values.domainName) {
    body.domainName = { primaryLinkUrl: values.domainName, primaryLinkLabel: "" };
  }
  try {
    const res = await twentyRequest<{ data?: { createCompany?: { id: string } }; id?: string }>(
      "/rest/companies",
      { method: "POST", body: JSON.stringify(body) },
    );
    const id = res.data?.createCompany?.id ?? (res as { id?: string }).id;
    if (!id) throw new Error("Twenty createCompany returned no id");
    return { id };
  } catch (err) {
    if (err instanceof TwentyApiError && err.status === 409) {
      const existing = await findTwentyCompanyByName(values.name);
      if (existing) return existing;
    }
    throw err;
  }
}

export async function upsertTwentyCompany(
  values: TwentyCompanyValues,
): Promise<{ id: string }> {
  const existing = await findTwentyCompanyByName(values.name);
  if (existing) return existing;
  return createTwentyCompany(values);
}

// ─── Opportunities ────────────────────────────────────────────────────────────

export async function queryTwentyOpportunities() {
  return paginateAll("opportunities");
}

export async function findTwentyOpportunityByName(
  name: string,
  companyId?: string,
): Promise<{ id: string } | null> {
  const encoded = encodeURIComponent(name);
  const filter = companyId
    ? `filter=name[eq]:${encoded},companyId[eq]:${companyId}`
    : `filter=name[eq]:${encoded}`;
  const res = await twentyRequest<{
    data?: { opportunities?: Array<{ id: string }> };
  }>(`/rest/opportunities?${filter}&limit=1`, { method: "GET" });
  return res.data?.opportunities?.[0] ?? null;
}

function buildOpportunityBody(
  values: TwentyOpportunityValues,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (values.name !== undefined) body.name = values.name;
  if (values.stage !== undefined) body.stage = values.stage;
  if (values.companyId !== undefined) body.companyId = values.companyId;
  if (values.pointOfContactId !== undefined) body.pointOfContactId = values.pointOfContactId;
  if (values.closeDate !== undefined) body.closeDate = values.closeDate;
  return body;
}

export async function createTwentyOpportunity(
  values: TwentyOpportunityValues,
): Promise<{ id: string }> {
  if (!values.name) throw new Error("Twenty opportunity requires a name");
  try {
    const res = await twentyRequest<{
      data?: { createOpportunity?: { id: string } };
      id?: string;
    }>("/rest/opportunities", {
      method: "POST",
      body: JSON.stringify(buildOpportunityBody(values)),
    });
    const id = res.data?.createOpportunity?.id ?? (res as { id?: string }).id;
    if (!id) throw new Error("Twenty createOpportunity returned no id");
    return { id };
  } catch (err) {
    if (err instanceof TwentyApiError && err.status === 409 && values.name) {
      const existing = await findTwentyOpportunityByName(values.name, values.companyId);
      if (existing) return existing;
    }
    throw err;
  }
}

export async function updateTwentyOpportunity(
  opportunityId: string,
  values: TwentyOpportunityValues,
): Promise<{ id: string }> {
  const res = await twentyRequest<{
    data?: { updateOpportunity?: { id: string } };
    id?: string;
  }>(`/rest/opportunities/${opportunityId}`, {
    method: "PATCH",
    body: JSON.stringify(buildOpportunityBody(values)),
  });
  const id =
    res.data?.updateOpportunity?.id ?? (res as { id?: string }).id ?? opportunityId;
  return { id };
}

export async function upsertTwentyOpportunity(
  values: TwentyOpportunityValues,
): Promise<{ id: string }> {
  if (!values.name) throw new Error("Twenty opportunity requires a name");
  const existing = await findTwentyOpportunityByName(values.name, values.companyId);
  if (existing) return updateTwentyOpportunity(existing.id, values);
  return createTwentyOpportunity(values);
}
