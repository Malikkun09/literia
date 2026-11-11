function isIp(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return value.split(".").every((part) => Number(part) <= 255);
  }
  return value.includes(":") && /^[0-9a-fA-F:.]+$/.test(value);
}

export function clientAddress(headers: Headers): string {
  const cloudflare = headers.get("cf-connecting-ip")?.trim();
  if (cloudflare && isIp(cloudflare)) return cloudflare;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const addedByProxy = hops[hops.length - 1];
    if (addedByProxy && isIp(addedByProxy)) return addedByProxy;
  }

  const real = headers.get("x-real-ip")?.trim();
  if (real && isIp(real)) return real;
  return "unknown";
}
