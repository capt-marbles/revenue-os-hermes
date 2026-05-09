const ATTIO_API = "https://api.attio.com/v2";

export class AttioConfigError extends Error {
  constructor(message = "ATTIO_API_KEY not set") {
    super(message);
    this.name = "AttioConfigError";
  }
}

export class AttioApiError extends Error {
  status: number;
  details: string;

  constructor(status: number, details: string) {
    super(`Attio API error: ${status}`);
    this.name = "AttioApiError";
    this.status = status;
    this.details = details;
  }
}

export interface AttioPersonValues {
  email_addresses?: string[];
  name?: Array<{
    first_name?: string;
    last_name?: string;
    full_name: string;
  }>;
  description?: string;
  linkedin?: string;
}

function getAttioHeaders() {
  const key = process.env.ATTIO_API_KEY;
  if (!key) throw new AttioConfigError();
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function attioRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${ATTIO_API}${path}`, {
    ...init,
    headers: {
      ...getAttioHeaders(),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new AttioApiError(response.status, details);
  }

  return response.json() as Promise<T>;
}

export async function queryAttioPeopleRecords(limit = 100) {
  return attioRequest("/objects/people/records/query", {
    method: "POST",
    body: JSON.stringify({
      sorts: [
        {
          attribute: "created_at",
          field: "created_at",
          direction: "desc",
        },
      ],
      limit,
    }),
  });
}

export async function queryAttioDealRecords(limit = 100) {
  return attioRequest("/objects/deals/records/query", {
    method: "POST",
    body: JSON.stringify({
      sorts: [
        {
          attribute: "created_at",
          field: "created_at",
          direction: "desc",
        },
      ],
      limit,
    }),
  });
}

export async function assertAttioPersonRecord(values: AttioPersonValues) {
  return attioRequest("/objects/people/records?matching_attribute=email_addresses", {
    method: "PUT",
    body: JSON.stringify({
      data: {
        values,
      },
    }),
  });
}

export async function createAttioPersonRecord(values: AttioPersonValues) {
  return attioRequest("/objects/people/records", {
    method: "POST",
    body: JSON.stringify({
      data: {
        values,
      },
    }),
  });
}

export async function updateAttioPersonRecord(recordId: string, values: AttioPersonValues) {
  return attioRequest(`/objects/people/records/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({
      data: {
        values,
      },
    }),
  });
}
