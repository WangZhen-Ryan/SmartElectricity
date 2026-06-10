const SENSITIVE_VALUE_PATTERNS = [
  "token",
  "password",
  "secret",
  "credential",
  "bridgeurl",
  "bridge_url",
  "host",
  "port",
  "unitid",
  "unit_id",
  "baseaddr",
  "base_addr",
  "username",
  "apikey",
  "api_key",
];

export const CLOUD_CONFIG_DENYLIST_FIELDS = [
  "amber_token",
  "amberToken",
  "sigenPassword",
  "sigen_password",
  "sigenUsername",
  "sigen_username",
  "haToken",
  "ha_token",
  "host",
  "port",
  "unitId",
  "unit_id",
  "baseAddr",
  "base_addr",
  "bridgeUrl",
  "bridge_url",
  "vendorCredentials",
  "vendor_credentials",
] as const;

export const PUBLIC_PAYLOAD_DENYLIST_FIELDS = [
  ...CLOUD_CONFIG_DENYLIST_FIELDS,
  "modbus",
  "batteryHost",
  "battery_host",
  "connectorHost",
  "connector_host",
] as const;

function isDeniedKey(key: string, denylist: readonly string[]) {
  const lower = key.toLowerCase();
  return denylist.some((entry) => lower === entry.toLowerCase());
}

function looksSensitiveKey(key: string) {
  const lower = key.toLowerCase();
  return SENSITIVE_VALUE_PATTERNS.some((pattern) => lower.includes(pattern));
}

export function sanitizeObjectForScope<T extends Record<string, unknown>>(
  input: T,
  denylist: readonly string[],
): Partial<T> {
  const next: Record<string, unknown> = {};
  Object.entries(input).forEach(([key, value]) => {
    if (isDeniedKey(key, denylist) || looksSensitiveKey(key)) {
      return;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      next[key] = sanitizeObjectForScope(value as Record<string, unknown>, denylist);
      return;
    }
    next[key] = value;
  });
  return next as Partial<T>;
}

export function assertNoSensitiveKeys(
  input: Record<string, unknown>,
  denylist: readonly string[],
  path = "root",
) {
  Object.entries(input).forEach(([key, value]) => {
    if (isDeniedKey(key, denylist) || looksSensitiveKey(key)) {
      throw new Error(`Sensitive field "${path}.${key}" is not allowed in this payload.`);
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      assertNoSensitiveKeys(value as Record<string, unknown>, denylist, `${path}.${key}`);
    }
  });
}

export function sanitizeCloudConfigPayload<T extends Record<string, unknown>>(input: T) {
  return sanitizeObjectForScope(input, CLOUD_CONFIG_DENYLIST_FIELDS);
}

export function assertCloudConfigPayload(input: Record<string, unknown>) {
  assertNoSensitiveKeys(input, CLOUD_CONFIG_DENYLIST_FIELDS);
}

export function prepareCloudConfigPayload<T extends Record<string, unknown>>(input: T) {
  const sanitized = sanitizeCloudConfigPayload(input);
  assertCloudConfigPayload(sanitized as Record<string, unknown>);
  return sanitized;
}

export function sanitizePublicLeaderboardPayload<T extends Record<string, unknown>>(input: T) {
  return sanitizeObjectForScope(input, PUBLIC_PAYLOAD_DENYLIST_FIELDS);
}

export function assertPublicLeaderboardPayload(input: Record<string, unknown>) {
  assertNoSensitiveKeys(input, PUBLIC_PAYLOAD_DENYLIST_FIELDS);
}

export function preparePublicLeaderboardPayload<T extends Record<string, unknown>>(input: T) {
  const sanitized = sanitizePublicLeaderboardPayload(input);
  assertPublicLeaderboardPayload(sanitized as Record<string, unknown>);
  return sanitized;
}

export const PRIVACY_BOUNDARY_COPY = {
  cloud:
    "Cloud sync stores non-secret setup only. Tokens, passwords, hostnames, bridge URLs, and vendor credentials stay local or server-side.",
  public:
    "Public leaderboard rows include only public performance metrics. Local battery connection fields and credentials are excluded.",
};
