/**
 * Utility: SSRF protection and URL validation.
 * Blocks requests to private/loopback/link-local IP ranges.
 */
import { URL } from "url";
import dns from "dns";
import { promisify } from "util";

const resolveDns = promisify(dns.resolve4);

// RFC 1918, loopback, link-local, etc.
const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_RANGES.some((re) => re.test(ip));
}

export async function validateUrl(raw: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`URL must use http or https scheme`);
  }

  const hostname = parsed.hostname;

  // Resolve the host to check for SSRF
  let addresses: string[];
  try {
    addresses = await resolveDns(hostname);
  } catch {
    throw new Error(`Cannot resolve host: ${hostname}`);
  }

  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      throw new Error(`URL resolves to a private IP address (SSRF protection)`);
    }
  }

  return parsed;
}

export function validateFilePath(filePath: string): string {
  const normalized = filePath.trim();
  if (!normalized || normalized.includes("\0")) {
    throw new Error("Invalid file path");
  }
  return normalized;
}
