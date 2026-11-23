const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readPackageUid(code: string): string | null {
  let uid = code.trim();
  if (/^https?:\/\//i.test(uid)) {
    try {
      // Label QR codes carry the UID in the hash (`/trace#uid=…&code=…`); older links used `?uid=`.
      const url = new URL(uid);
      uid = url.searchParams.get('uid') || new URLSearchParams(url.hash.replace(/^#/, '')).get('uid') || '';
    } catch {
      return null;
    }
  }
  return UUID.test(uid) ? uid.toLowerCase() : null;
}
