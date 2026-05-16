export interface GeocodingResult {
  latitude: number;
  longitude: number;
  displayName: string;
}

export interface GeocodingProvider {
  geocode(address: string): Promise<GeocodingResult | null>;
}

export const GEOCODING_PROVIDER = Symbol('GEOCODING_PROVIDER');
