import { defineString } from "firebase-functions/params";

const measureOneClientId = defineString("MEASUREONE_CLIENT_ID");
const measureOneSecret = defineString("MEASUREONE_SECRET");
const measureOneBaseUrl = defineString("MEASUREONE_BASE_URL", {
  default: "https://api-stg.measureone.com",
});

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const response = await fetch(
    `${measureOneBaseUrl.value()}/v3/auth/generate_access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: measureOneClientId.value(),
        secret_key: measureOneSecret.value(),
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`MeasureOne auth failed: ${response.status} ${error}`);
  }

  const data = await response.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  return tokenCache.token;
}

async function apiRequest<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<T> {
  const token = await getAccessToken();

  const response = await fetch(
    `${measureOneBaseUrl.value()}${endpoint}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `MeasureOne API error: ${response.status} ${error}`
    );
  }

  return response.json() as Promise<T>;
}

export const measureOneClient = {
  createIndividual: (params: {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
  }) => apiRequest<{ id: string }>("/v3/individuals/new", params),

  createDataRequest: (params: {
    individual_id: string;
    enable_report_updates?: boolean;
    refresh_policy?: boolean;
  }) =>
    apiRequest<{ id: string }>("/v3/datarequests/new", {
      ...params,
      type: "AUTO_INSURANCE_DETAILS",
      enable_report_updates: params.enable_report_updates ?? true,
      refresh_policy: params.refresh_policy ?? true,
    }),

  generateInvitationLink: (params: { datarequest_id: string }) =>
    apiRequest<{ url: string }>(
      "/v3/datarequests/generate_invitation_link",
      params
    ),

  getInsuranceDetails: (params: { datarequest_id: string }) =>
    apiRequest<{ records: unknown[] }>(
      "/v3/services/get_insurance_details",
      params
    ),
};
