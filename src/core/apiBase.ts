export function getApiBase(value: string | undefined = process.env.EXPO_PUBLIC_API_BASE): string {
  const raw = value?.trim() || '';
  if (!raw) {
    throw new Error('EXPO_PUBLIC_API_BASE is missing. Set it to the HTTPS backend origin in your local .env.local or EAS build profile.');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('EXPO_PUBLIC_API_BASE must be a valid HTTPS backend origin, such as https://api.example.com.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('EXPO_PUBLIC_API_BASE must be an HTTPS origin without credentials, path, query, or fragment.');
  }
  return url.origin;
}
