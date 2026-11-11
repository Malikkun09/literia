import { isIP } from "node:net";

function isIp(value: string): boolean {
  return isIP(value) !== 0;
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
