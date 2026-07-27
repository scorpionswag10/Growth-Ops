import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { execFile } from "child_process";
import { promisify } from "util";
import { lookup } from "dns/promises";
import { isIP } from "net";
import * as path from "path";
import { PrismaService } from "../prisma/prisma.service";

const execFileAsync = promisify(execFile);

// apps/api/vendor/seo-audit.sh (vendored from the seo-aeo-optimization skill —
// see that skill's own docs for what each JSON section means). Deployed
// alongside dist/ inside the container image (see Dockerfile.api).
const SCRIPT_PATH = path.join(__dirname, "..", "..", "vendor", "seo-audit.sh");
const TIMEOUT_MS = 45_000;

const SEVERITY_PENALTY: Record<string, number> = {
  CRITICAL: 40,
  HIGH: 25,
  MEDIUM: 15,
  LOW: 5,
};

interface Finding {
  severity: string;
  message: string;
  fix: string;
}

function scoreFromFindings(findings: Finding[]): number {
  const penalty = findings.reduce(
    (sum, f) => sum + (SEVERITY_PENALTY[f.severity] ?? 0),
    0,
  );
  return Math.max(0, 100 - penalty);
}

// Blocks requests to private/loopback/link-local targets so this endpoint
// (which shells out and fetches whatever URL a user submits) can't be used
// to probe internal infrastructure — same class of concern as Postiz's own
// SSRF guard on self-hosted-URL providers.
async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new BadRequestException("Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BadRequestException("URL must be http or https");
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new BadRequestException("URL must be a public site");
  }
  let addresses: string[];
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      const results = await lookup(hostname, { all: true });
      addresses = results.map((r) => r.address);
    } catch {
      throw new BadRequestException("Could not resolve that hostname");
    }
  }
  for (const addr of addresses) {
    if (isPrivateOrReservedIp(addr)) {
      throw new BadRequestException("URL must be a public site");
    }
  }
  return url;
}

function isPrivateOrReservedIp(addr: string): boolean {
  if (isIP(addr) === 4) {
    const [a, b] = addr.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (isIP(addr) === 6) {
    const lower = addr.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80")
    );
  }
  return true; // couldn't classify — fail closed
}

@Injectable()
export class SeoService {
  private readonly log = new Logger("Seo");

  constructor(private prisma: PrismaService) {}

  async run(locationId: string, rawUrl: string) {
    const url = await assertPublicHttpUrl(rawUrl);

    let stdout: string;
    try {
      const result = await execFileAsync(
        "bash",
        [SCRIPT_PATH, "--json", url.toString()],
        { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      );
      stdout = result.stdout;
    } catch (err) {
      this.log.warn(`audit failed for ${url}: ${String(err)}`);
      throw new BadRequestException(
        "Couldn't audit that URL — it may be unreachable or blocking automated requests.",
      );
    }

    let parsed: { findings?: Finding[] };
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new BadRequestException("Audit produced unreadable output");
    }

    const score = scoreFromFindings(parsed.findings ?? []);

    return this.prisma.withLocation(locationId, (tx) =>
      tx.seoAudit.create({
        data: { locationId, url: url.toString(), score, result: parsed as object },
      }),
    );
  }

  list(locationId: string) {
    return this.prisma.withLocation(locationId, (tx) =>
      tx.seoAudit.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, url: true, score: true, createdAt: true },
      }),
    );
  }

  get(locationId: string, id: string) {
    return this.prisma.withLocation(locationId, (tx) =>
      tx.seoAudit.findUnique({ where: { id } }),
    );
  }
}
