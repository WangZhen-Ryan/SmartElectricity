import { WeatherPoint } from "../core/types";
import {
  fetchCloudCoverFromProvider,
  SolarProvider,
} from "./solar_provider";

export async function fetchCloudCover(
  apiBase: string,
  anonKey: string | undefined,
  params: {
    startDate: string;
    endDate: string;
    latitude: number;
    longitude: number;
    timezone: string;
    provider?: SolarProvider;
  },
): Promise<WeatherPoint[]> {
  const result = await fetchCloudCoverFromProvider(apiBase, anonKey, {
    ...params,
    provider: params.provider || "auto",
  });
  return result.points;
}
