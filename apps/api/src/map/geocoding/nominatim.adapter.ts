import { Injectable, Logger } from '@nestjs/common';
import { GeocodingProvider, GeocodingResult } from './geocoding.interface';

const NOMINATIM_MIN_INTERVAL_MS = 1100;
const NOMINATIM_TIMEOUT_MS = 10_000;

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
};

@Injectable()
export class NominatimAdapter implements GeocodingProvider {
  private readonly logger = new Logger(NominatimAdapter.name);
  private lastRequestAt = 0;

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < NOMINATIM_MIN_INTERVAL_MS) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, NOMINATIM_MIN_INTERVAL_MS - elapsed),
      );
    }
    this.lastRequestAt = Date.now();
  }

  async geocode(address: string): Promise<GeocodingResult | null> {
    await this.enforceRateLimit();

    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(address)}&format=json&limit=1`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': process.env.GEOCODING_USER_AGENT ?? 'NodeScope/1.0',
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(`Nominatim returned ${response.status} for address: ${address}`);
        return null;
      }

      const results = (await response.json()) as NominatimResult[];
      if (!results.length) return null;

      return {
        latitude: parseFloat(results[0].lat),
        longitude: parseFloat(results[0].lon),
        displayName: results[0].display_name,
      };
    } catch (error) {
      this.logger.warn({ error }, 'Nominatim geocoding request failed');
      return null;
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }
}
