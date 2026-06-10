import { useMemo, useState } from "react";
import { mapAustralianPostcode } from "../core/regions";

export function useAccountRegionState(defaultRegion = "AU-NSW") {
  const [authPostcode, setAuthPostcode] = useState("");
  const authRegionFromPostcode = useMemo(
    () => mapAustralianPostcode(authPostcode),
    [authPostcode],
  );
  const effectiveAuthRegion = authPostcode.trim()
    ? authRegionFromPostcode.code
    : defaultRegion;

  return {
    authPostcode,
    setAuthPostcode,
    authRegionFromPostcode,
    effectiveAuthRegion,
  };
}
