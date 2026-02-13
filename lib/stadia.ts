const DEFAULT_STADIA_BASE_URL = 'https://api.stadiamaps.com';

export function getStadiaBaseUrl(): string {
  return process.env.STADIA_BASE_URL?.trim() || DEFAULT_STADIA_BASE_URL;
}

export function getStadiaAuthHeaders(): Record<string, string> {
  const apiKey = process.env.STADIA_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('STADIA_API_KEY is required for Stadia API requests.');
  }

  return {
    Authorization: `Stadia-Auth ${apiKey}`
  };
}

export function buildStadiaUrl(pathname: string): string {
  return new URL(pathname, getStadiaBaseUrl()).toString();
}
