export type RegionBucketMeta = {
  code: string;
  short: string;
  label: string;
  market: string;
  postcodeRange: string;
  tone: string;
  fallbackPulse: string;
  fallbackRatio: number;
};

export type PostcodeRegionMatch = {
  code: string;
  label: string;
  market: string;
  valid: boolean;
};

export const DEFAULT_REGION: PostcodeRegionMatch = {
  code: "AU-NSW",
  label: "NSW",
  market: "NSW / ACT",
  valid: false,
};

export function mapAustralianPostcode(postcode: string): PostcodeRegionMatch {
  const digits = postcode.replace(/\D/g, "");
  if (!digits) {
    return DEFAULT_REGION;
  }
  const value = Number(digits);
  if (!Number.isFinite(value)) {
    return DEFAULT_REGION;
  }
  if (value >= 800 && value <= 999) {
    return { code: "AU-NT", label: "NT", market: "Northern Territory", valid: true };
  }
  if (
    (value >= 1000 && value <= 2599) ||
    (value >= 2619 && value <= 2899) ||
    (value >= 2921 && value <= 2999)
  ) {
    return { code: "AU-NSW", label: "NSW", market: "New South Wales", valid: true };
  }
  if ((value >= 2600 && value <= 2618) || (value >= 2900 && value <= 2920)) {
    return { code: "AU-ACT", label: "ACT", market: "Australian Capital Territory", valid: true };
  }
  if ((value >= 3000 && value <= 3999) || (value >= 8000 && value <= 8999)) {
    return { code: "AU-VIC", label: "VIC", market: "Victoria", valid: true };
  }
  if ((value >= 4000 && value <= 4999) || (value >= 9000 && value <= 9999)) {
    return { code: "AU-QLD", label: "QLD", market: "Queensland", valid: true };
  }
  if (value >= 5000 && value <= 5999) {
    return { code: "AU-SA", label: "SA", market: "South Australia", valid: true };
  }
  if (value >= 6000 && value <= 6999) {
    return { code: "AU-WA", label: "WA", market: "Western Australia", valid: true };
  }
  if (value >= 7000 && value <= 7999) {
    return { code: "AU-TAS", label: "TAS", market: "Tasmania", valid: true };
  }
  return DEFAULT_REGION;
}

export const AU_REGION_BUCKETS = [
  {
    code: "AU-WA",
    short: "WA",
    label: "Western Australia",
    market: "WA market",
    postcodeRange: "6000-6999",
    tone: "cool",
    fallbackPulse: "Solar-heavy",
    fallbackRatio: 0.11,
  },
  {
    code: "AU-NT",
    short: "NT",
    label: "Northern Territory",
    market: "NT market",
    postcodeRange: "0800-0999",
    tone: "cool",
    fallbackPulse: "Sparse",
    fallbackRatio: 0.04,
  },
  {
    code: "AU-SA",
    short: "SA",
    label: "South Australia",
    market: "SA market",
    postcodeRange: "5000-5999",
    tone: "warm",
    fallbackPulse: "Export spike",
    fallbackRatio: 0.1,
  },
  {
    code: "AU-QLD",
    short: "QLD",
    label: "Queensland",
    market: "QLD market",
    postcodeRange: "4000-4999 / 9000-9999",
    tone: "warm",
    fallbackPulse: "Charge bias",
    fallbackRatio: 0.17,
  },
  {
    code: "AU-NSW",
    short: "NSW",
    label: "New South Wales",
    market: "NSW market",
    postcodeRange: "1000-2599 / 2619-2999",
    tone: "hot",
    fallbackPulse: "Most active",
    fallbackRatio: 0.34,
  },
  {
    code: "AU-ACT",
    short: "ACT",
    label: "Australian Capital Territory",
    market: "ACT market",
    postcodeRange: "2600-2618 / 2900-2920",
    tone: "warm",
    fallbackPulse: "Tight spread",
    fallbackRatio: 0.03,
  },
  {
    code: "AU-VIC",
    short: "VIC",
    label: "Victoria",
    market: "VIC market",
    postcodeRange: "3000-3999 / 8000-8999",
    tone: "warm",
    fallbackPulse: "Fast cycling",
    fallbackRatio: 0.16,
  },
  {
    code: "AU-TAS",
    short: "TAS",
    label: "Tasmania",
    market: "TAS market",
    postcodeRange: "7000-7999",
    tone: "cool",
    fallbackPulse: "Stable",
    fallbackRatio: 0.05,
  },
] as const satisfies readonly RegionBucketMeta[];

export const AU_SVG_REGIONS = [
  {
    short: "WA",
    d: "M72 108 L144 88 L176 122 L170 232 L142 280 L92 298 L58 250 L56 154 Z",
    labelX: 112,
    labelY: 196,
  },
  {
    short: "NT",
    d: "M176 106 L256 96 L274 126 L264 188 L188 188 L170 160 Z",
    labelX: 220,
    labelY: 144,
  },
  {
    short: "SA",
    d: "M184 188 L264 188 L282 216 L270 278 L206 284 L170 234 Z",
    labelX: 226,
    labelY: 236,
  },
  {
    short: "QLD",
    d: "M274 120 L366 106 L418 138 L406 224 L320 226 L286 194 Z",
    labelX: 350,
    labelY: 164,
  },
  {
    short: "NSW",
    d: "M282 224 L402 224 L420 266 L384 308 L294 296 L272 260 Z",
    labelX: 348,
    labelY: 258,
  },
  {
    short: "VIC",
    d: "M292 296 L382 308 L366 338 L306 340 L272 320 Z",
    labelX: 326,
    labelY: 322,
  },
  {
    short: "ACT",
    d: "M392 264 A10 10 0 1 1 391.9 264 Z",
    labelX: 392,
    labelY: 266,
  },
  {
    short: "TAS",
    d: "M332 366 L362 374 L354 402 L326 396 L320 378 Z",
    labelX: 342,
    labelY: 386,
  },
] as const;

export function getRegionBucketMeta(regionCode: string) {
  return AU_REGION_BUCKETS.find((bucket) => bucket.code === regionCode) || AU_REGION_BUCKETS[4];
}
