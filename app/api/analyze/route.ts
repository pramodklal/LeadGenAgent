import { NextResponse } from "next/server";

type AnalyzeRequest = {
  discovery_query?: string;
  target_verticals?: string[];
  geo_focus?: string;
  icp_constraints?: string[];
  successful_client_signals?: string[];
  company_limit?: number;
  evidence_text?: string;
};

type PotentialCustomer = {
  company_name: string;
  website?: string | null;
  industry?: string | null;
  why_match?: string | null;
  contact_name?: string | null;
  contact_title?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  contact_linkedin?: string | null;
  contact_confidence?: "high" | "medium" | "low" | null;
  contact_notes?: string | null;
};

type AnalyzeResponse = {
  discovered_companies: PotentialCustomer[];
  tier: "tier_1" | "tier_2" | "disqualified";
  fit_score: number;
  outreach_angle: string;
};

type DemoLeadTemplate = {
  company_name: string;
  website: string;
  industry: string;
  why_match: string;
};

const demoLeadTemplates: DemoLeadTemplate[] = [
  {
    company_name: "Atlantic Brokerage Network",
    website: "https://example.com",
    industry: "Insurance Network",
    why_match: "Distributed producer network, multi-state book management, and commission workflow complexity.",
  },
  {
    company_name: "Garden State MGA Group",
    website: "https://example.com",
    industry: "MGA",
    why_match: "Carrier program operations and onboarding complexity suggest a strong fit for book-of-business visibility.",
  },
  {
    company_name: "Northeast Independent Partners",
    website: "https://example.com",
    industry: "IMO",
    why_match: "Producer hierarchy, recruiting motion, and multi-office distribution resemble your target customer profile.",
  },
  {
    company_name: "Mid-Atlantic Risk Distribution",
    website: "https://example.com",
    industry: "Insurance Network",
    why_match: "Scale across agencies and carriers creates the lead-to-policy-to-commission visibility gap you sell against.",
  },
  {
    company_name: "Summit Channel Holdings",
    website: "https://example.com",
    industry: "MGA",
    why_match: "Regional growth and manual reporting pain make this a strong book-of-business modernization candidate.",
  },
];

function clampCompanyLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 10;
  }
  const rounded = Math.floor(value as number);
  return Math.max(1, Math.min(rounded, 100));
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function extractJsonObjectString(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");
  const startCandidates = [firstBrace, firstBracket].filter((idx) => idx >= 0);
  if (startCandidates.length === 0) {
    return null;
  }

  const start = Math.min(...startCandidates);
  const endBrace = trimmed.lastIndexOf("}");
  const endBracket = trimmed.lastIndexOf("]");
  const end = Math.max(endBrace, endBracket);
  if (end <= start) {
    return null;
  }

  return trimmed.slice(start, end + 1).trim();
}

function parseModelPayload(content: string): unknown | null {
  const direct = safeJsonParse<unknown>(content);
  if (direct) {
    return direct;
  }

  const extracted = extractJsonObjectString(content);
  if (!extracted) {
    return null;
  }

  return safeJsonParse<unknown>(extracted);
}

function isFoundryV1Endpoint(endpoint: string): boolean {
  return /\/openai\/v1\/?$/i.test(endpoint.trim());
}

function normalizeConfidence(value: unknown): "high" | "medium" | "low" | null {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return null;
}

function parseDomainFromWebsite(website: string | null | undefined): string | null {
  if (!website || typeof website !== "string") {
    return null;
  }

  try {
    const url = website.startsWith("http://") || website.startsWith("https://") ? new URL(website) : new URL(`https://${website}`);
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function splitContactName(fullName: string | null | undefined): { firstName: string; lastName: string } | null {
  if (!fullName || typeof fullName !== "string") {
    return null;
  }

  const parts = fullName
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[^a-zA-Z\-']/g, ""))
    .filter((part) => part.length > 0);

  if (parts.length < 2) {
    return null;
  }

  return {
    firstName: parts[0],
    lastName: parts[parts.length - 1],
  };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
  }
}

async function getHunterEmail(
  hunterApiKey: string,
  domain: string,
  firstName: string,
  lastName: string
): Promise<{ email: string; score: number | null } | null> {
  const params = new URLSearchParams({
    domain,
    first_name: firstName,
    last_name: lastName,
    api_key: hunterApiKey,
  });

  const url = `https://api.hunter.io/v2/email-finder?${params.toString()}`;
  const response = await fetchWithTimeout(url, 7000);
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { data?: { email?: unknown; score?: unknown } };
  const email = payload.data?.email;
  const scoreRaw = payload.data?.score;
  const score = Number.isFinite(Number(scoreRaw)) ? Number(scoreRaw) : null;

  if (typeof email !== "string" || email.trim().length === 0) {
    return null;
  }

  return { email: email.trim(), score };
}

type HunterDomainCandidate = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  score: number | null;
};

async function getHunterDomainCandidates(
  hunterApiKey: string,
  domain: string
): Promise<HunterDomainCandidate[]> {
  const params = new URLSearchParams({
    domain,
    limit: "10",
    api_key: hunterApiKey,
  });

  const url = `https://api.hunter.io/v2/domain-search?${params.toString()}`;
  const response = await fetchWithTimeout(url, 7000);
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as {
    data?: {
      emails?: Array<{
        value?: unknown;
        first_name?: unknown;
        last_name?: unknown;
        position?: unknown;
        confidence?: unknown;
      }>;
    };
  };

  const emails = payload.data?.emails;
  if (!Array.isArray(emails)) {
    return [];
  }

  return emails
    .filter((item) => item && typeof item.value === "string" && item.value.trim().length > 0)
    .map((item) => ({
      email: String(item.value).trim(),
      firstName: typeof item.first_name === "string" ? item.first_name.trim() : null,
      lastName: typeof item.last_name === "string" ? item.last_name.trim() : null,
      position: typeof item.position === "string" ? item.position.trim() : null,
      score: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null,
    }));
}

function normalizeText(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function pickBestHunterDomainCandidate(
  candidates: HunterDomainCandidate[],
  requestedFirstName: string | null,
  requestedLastName: string | null,
  requestedTitle: string | null | undefined
): HunterDomainCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  const firstNameNorm = normalizeText(requestedFirstName);
  const lastNameNorm = normalizeText(requestedLastName);
  const titleNorm = normalizeText(requestedTitle);
  const seniorTitleKeywords = ["chief", "ceo", "president", "founder", "owner", "vp", "vice president", "director", "principal", "partner"];

  const ranked = candidates
    .map((candidate) => {
      let rank = 0;
      const candidateFirst = normalizeText(candidate.firstName);
      const candidateLast = normalizeText(candidate.lastName);
      const candidateTitle = normalizeText(candidate.position);

      if (candidateFirst && candidateFirst === firstNameNorm) {
        rank += 40;
      }
      if (candidateLast && candidateLast === lastNameNorm) {
        rank += 50;
      }

      if (titleNorm && candidateTitle) {
        if (candidateTitle.includes(titleNorm) || titleNorm.includes(candidateTitle)) {
          rank += 20;
        } else {
          const titleKeywords = titleNorm.split(" ").filter((word) => word.length > 3);
          if (titleKeywords.some((word) => candidateTitle.includes(word))) {
            rank += 10;
          }
        }
      }

      if (candidateTitle && seniorTitleKeywords.some((keyword) => candidateTitle.includes(keyword))) {
        rank += 8;
      }

      if (candidate.score !== null) {
        rank += Math.round(candidate.score / 10);
      }

      return { candidate, rank };
    })
    .sort((a, b) => b.rank - a.rank);

  return ranked[0]?.candidate ?? null;
}

async function enrichCustomersWithHunter(
  customers: PotentialCustomer[],
  hunterApiKey: string,
  maxEnrichments: number
): Promise<PotentialCustomer[]> {
  let enrichCount = 0;
  const enriched: PotentialCustomer[] = [];

  for (const customer of customers) {
    if (customer.contact_email || enrichCount >= maxEnrichments) {
      enriched.push(customer);
      continue;
    }

    const domain = parseDomainFromWebsite(customer.website);
    const nameParts = splitContactName(customer.contact_name);
    if (!domain) {
      enriched.push(customer);
      continue;
    }

    enrichCount += 1;

    try {
      const finderResult = nameParts
        ? await getHunterEmail(hunterApiKey, domain, nameParts.firstName, nameParts.lastName)
        : null;

      let selectedEmail: string | null = null;
      let selectedScore: number | null = null;
      let sourceNote = "Email enriched via Hunter Email Finder.";
      let selectedFirstName: string | null = null;
      let selectedLastName: string | null = null;
      let selectedPosition: string | null = null;

      if (finderResult && nameParts) {
        selectedEmail = finderResult.email;
        selectedScore = finderResult.score;
      } else {
        const domainCandidates = await getHunterDomainCandidates(hunterApiKey, domain);
        const bestCandidate = pickBestHunterDomainCandidate(
          domainCandidates,
          nameParts?.firstName ?? null,
          nameParts?.lastName ?? null,
          customer.contact_title
        );

        if (bestCandidate) {
          selectedEmail = bestCandidate.email;
          selectedScore = bestCandidate.score;
          selectedFirstName = bestCandidate.firstName;
          selectedLastName = bestCandidate.lastName;
          selectedPosition = bestCandidate.position;
          sourceNote = "Email enriched via Hunter Domain Search fallback.";
        }
      }

      if (!selectedEmail) {
        const noMatchNotes = customer.contact_notes
          ? `${customer.contact_notes} | Hunter did not return a matching email.`
          : "Hunter did not return a matching email.";
        enriched.push({ ...customer, contact_notes: noMatchNotes });
        continue;
      }

      const nextNotes = customer.contact_notes
        ? `${customer.contact_notes} | ${sourceNote}`
        : sourceNote;

      let confidence: PotentialCustomer["contact_confidence"] = customer.contact_confidence ?? null;
      if (selectedScore !== null) {
        if (selectedScore >= 85) {
          confidence = "high";
        } else if (selectedScore >= 60) {
          confidence = "medium";
        } else {
          confidence = "low";
        }
      }

      const enrichedContactName =
        customer.contact_name ??
        (selectedFirstName && selectedLastName ? `${selectedFirstName} ${selectedLastName}` : null);

      const enrichedContactTitle = customer.contact_title ?? selectedPosition;

      enriched.push({
        ...customer,
        contact_name: enrichedContactName,
        contact_title: enrichedContactTitle,
        contact_email: selectedEmail,
        contact_confidence: confidence,
        contact_notes: nextNotes,
      });
    } catch {
      enriched.push(customer);
    }
  }

  return enriched;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJsonWithRetry(
  url: string,
  init: RequestInit,
  maxAttempts: number = 3
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, init);

      if (response.status >= 500 && attempt < maxAttempts) {
        await sleep(300 * attempt);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(300 * attempt);
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Request to Azure OpenAI failed after retries.");
}

function normalizeResponse(payload: unknown): AnalyzeResponse | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as Record<string, unknown>;
  const companiesRaw = Array.isArray(data.discovered_companies)
    ? data.discovered_companies
    : Array.isArray(data.potential_customers)
      ? data.potential_customers
      : [];

  const discovered_companies: PotentialCustomer[] = companiesRaw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const candidate = item as Record<string, unknown>;
      return {
        company_name:
          typeof candidate.company_name === "string" && candidate.company_name.trim().length > 0
            ? candidate.company_name.trim()
            : "Unknown Company",
        website: typeof candidate.website === "string" ? candidate.website : null,
        industry: typeof candidate.industry === "string" ? candidate.industry : null,
        why_match: typeof candidate.why_match === "string" ? candidate.why_match : null,
        contact_name: typeof candidate.contact_name === "string" ? candidate.contact_name : null,
        contact_title: typeof candidate.contact_title === "string" ? candidate.contact_title : null,
        contact_email: typeof candidate.contact_email === "string" ? candidate.contact_email : null,
        contact_phone: typeof candidate.contact_phone === "string" ? candidate.contact_phone : null,
        contact_linkedin: typeof candidate.contact_linkedin === "string" ? candidate.contact_linkedin : null,
        contact_confidence: normalizeConfidence(candidate.contact_confidence),
        contact_notes: typeof candidate.contact_notes === "string" ? candidate.contact_notes : null,
      };
    })
    .slice(0, 100);

  const tierValue = data.tier;
  const tier: AnalyzeResponse["tier"] =
    tierValue === "tier_1" || tierValue === "tier_2" || tierValue === "disqualified" ? tierValue : "tier_2";

  const fitScoreRaw = Number(data.fit_score);
  const fit_score = Number.isFinite(fitScoreRaw) ? Math.max(0, Math.min(100, Math.round(fitScoreRaw))) : 0;

  const outreach_angle = typeof data.outreach_angle === "string" ? data.outreach_angle : "";

  if (discovered_companies.length === 0) {
    return null;
  }

  return {
    discovered_companies,
    tier,
    fit_score,
    outreach_angle,
  };
}

function buildDemoResponse(request: AnalyzeRequest): AnalyzeResponse {
  const geoFocus = request.geo_focus ?? "USA";
  const companyLimit = clampCompanyLimit(request.company_limit);
  const regionTags = ["North", "South", "Central", "East", "West", "Metro", "Regional", "National"];
  const discovered_companies: PotentialCustomer[] = [];

  for (let i = 0; i < companyLimit; i += 1) {
    const template = demoLeadTemplates[i % demoLeadTemplates.length];
    const regionTag = regionTags[Math.floor(i / demoLeadTemplates.length) % regionTags.length];
    discovered_companies.push({
      company_name: `${regionTag} ${template.company_name}`,
      website: template.website,
      industry: template.industry,
      why_match: `${template.why_match} Geo focus: ${geoFocus}.`,
      contact_name: null,
      contact_title: null,
      contact_email: null,
      contact_phone: null,
      contact_linkedin: null,
      contact_confidence: null,
      contact_notes: "Demo fallback result. Contact not enriched.",
    });
  }

  return {
    discovered_companies,
    tier: "tier_1",
    fit_score: 82,
    outreach_angle: "Demonstrate how a unified book-of-business view reduces manual reporting and improves producer visibility.",
  };
}

export async function POST(request: Request) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21";
  const allowDemoFallback = (process.env.ALLOW_DEMO_FALLBACK ?? "false").toLowerCase() === "true";
  const hunterApiKey = process.env.HUNTER_API_KEY;
  const hunterEnrichLimit = Math.max(1, Math.min(Number(process.env.HUNTER_ENRICH_LIMIT ?? "12"), 100));

  if (!endpoint || !apiKey || !deployment) {
    return NextResponse.json(
      {
        error:
          "Missing Azure OpenAI settings. Required: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT_NAME",
      },
      { status: 500 }
    );
  }

  const body = (await request.json()) as AnalyzeRequest;

  const discoveryQuery = body.discovery_query ?? "Find high-fit US insurance network, MGA, and IMO prospects";
  const targetVerticals = Array.isArray(body.target_verticals) ? body.target_verticals : ["insurance_network", "mga", "imo"];
  const geoFocus = body.geo_focus ?? "USA";
  const icpConstraints = Array.isArray(body.icp_constraints) ? body.icp_constraints : [];
  const successfulSignals = Array.isArray(body.successful_client_signals) ? body.successful_client_signals : [];
  const companyLimit = clampCompanyLimit(body.company_limit);
  const evidenceText = body.evidence_text ?? "";

  const instruction = [
    "You are an insurance lead generation analyst for a Book of Business platform.",
    "Find lookalike prospects similar to Synergy NMO, Alera Group, and Applied Ins.",
    "Return strict JSON only, no markdown.",
    "Output object shape:",
    '{"discovered_companies":[{"company_name":"","website":null,"industry":null,"why_match":null,"contact_name":null,"contact_title":null,"contact_email":null,"contact_phone":null,"contact_linkedin":null,"contact_confidence":"high|medium|low|null","contact_notes":null}],"tier":"tier_1|tier_2|disqualified","fit_score":0,"outreach_angle":""}',
    "Rules:",
    "- discovered_companies must include realistic organizations, no placeholder names.",
    "- why_match should explain insurance distribution fit and operational pain.",
    "- Add one best-guess outreach contact per company when confidently known from public context.",
    "- If contact data is unknown, set contact fields to null. Do not invent personal details.",
    "- contact_confidence must be high, medium, low, or null.",
    "- fit_score must be 0-100.",
    "- Respect company_limit exactly.",
  ].join("\n");

  const prompt = [
    `Discovery query: ${discoveryQuery}`,
    `Target verticals: ${targetVerticals.join(", ")}`,
    `Geo focus: ${geoFocus}`,
    `Company limit: ${companyLimit}`,
    `ICP constraints: ${icpConstraints.join(" | ") || "none"}`,
    `Successful client signals: ${successfulSignals.join(" | ") || "none"}`,
    `Evidence text: ${evidenceText || "none"}`,
  ].join("\n");

  const normalizedEndpoint = endpoint.replace(/\/+$/, "");
  const useFoundryV1 = isFoundryV1Endpoint(normalizedEndpoint);
  const url = useFoundryV1
    ? `${normalizedEndpoint}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`
    : `${normalizedEndpoint}/openai/deployments/${deployment}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  const requestBody: {
    temperature: number;
    messages: Array<{ role: "system" | "user"; content: string }>;
    model?: string;
  } = {
    temperature: 0.2,
    messages: [
      { role: "system", content: instruction },
      { role: "user", content: prompt },
    ],
  };

  if (useFoundryV1) {
    requestBody.model = deployment;
  }

  let azureResponse: Response;
  try {
    azureResponse = await postJsonWithRetry(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify(requestBody),
        cache: "no-store",
      },
      3
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown network error";
    return NextResponse.json(
      {
        error: "Azure OpenAI network request failed.",
        detail: message,
      },
      { status: 502 }
    );
  }

  if (!azureResponse.ok) {
    const detail = await azureResponse.text();
    if (allowDemoFallback && azureResponse.status === 404 && detail.includes("DeploymentNotFound")) {
      return NextResponse.json(buildDemoResponse(body));
    }
    return NextResponse.json(
      {
        error: `Azure OpenAI call failed with status ${azureResponse.status}`,
        detail,
      },
      { status: 502 }
    );
  }

  const azurePayload = (await azureResponse.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  };

  const messageContent = azurePayload.choices?.[0]?.message?.content;
  const content =
    typeof messageContent === "string"
      ? messageContent
      : Array.isArray(messageContent)
        ? messageContent
            .filter((part) => part && typeof part.text === "string")
            .map((part) => part.text as string)
            .join("\n")
        : undefined;
  if (!content) {
    return NextResponse.json({ error: "Azure response did not contain message content." }, { status: 502 });
  }

  const parsed = parseModelPayload(content);
  const normalized = normalizeResponse(parsed);

  if (!normalized) {
    if (allowDemoFallback) {
      return NextResponse.json(buildDemoResponse(body));
    }
    return NextResponse.json(
      {
        error: "Model response was not valid for the expected schema.",
        detail: content,
      },
      { status: 502 }
    );
  }

  if (hunterApiKey && hunterApiKey.trim().length > 0) {
    normalized.discovered_companies = await enrichCustomersWithHunter(
      normalized.discovered_companies,
      hunterApiKey.trim(),
      hunterEnrichLimit
    );
  }

  return NextResponse.json(normalized);
}