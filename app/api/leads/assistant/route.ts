import {
  AzureKeyCredential,
  SearchClient,
} from "@azure/search-documents";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type AssistantRequest = {
  query?: string;
  limit?: number;
  indexName?: string;
  searchAllIndexes?: boolean;
};

type AssistantMatch = {
  index_name: string;
  id: string;
  score: number | null;
  title: string;
  snippet: string;
  company_name?: string;
  email_message?: string;
  website?: string;
  industry?: string;
  why_match?: string;
  contact_name?: string;
  contact_title?: string;
  contact_email?: string;
  contact_phone?: string;
  state?: string;
};

type SearchDoc = Record<string, unknown>;

function isNonSearchableIndexErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("cannotsearchwithoutsearchablefields") ||
    normalized.includes("must contain one or more searchable string fields") ||
    normalized.includes("parameter name: search")
  );
}

function isPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("your-search-service") ||
    normalized.includes("your-azure-ai-search-admin-key") ||
    normalized.includes("your-")
  );
}

function toCleanString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveTitle(document: SearchDoc): string {
  const titleFields = ["company_name", "title", "name", "id"];
  for (const field of titleFields) {
    const value = toCleanString(document[field]);
    if (value) {
      if (field === "id") {
        const parts = value.split("-");
        if (parts.length > 2) {
          return parts.slice(1, -1).join(" ").replace(/\b\w/g, (c) => c.toUpperCase());
        }
      }
      return value;
    }
  }

  return "Result";
}

function resolveSnippet(document: SearchDoc): string {
  const snippetFields = [
    "email_message",
    "website",
    "content",
    "why_match",
    "contact_email",
    "contact_phone",
    "contact_name",
    "summary",
    "description",
    "industry",
    "state",
  ];

  for (const field of snippetFields) {
    const value = toCleanString(document[field]);
    if (value) {
      return value.slice(0, 220);
    }
  }

  const fallback = JSON.stringify(document);
  return fallback.slice(0, 220);
}

function isLowDetailDocument(document: SearchDoc): boolean {
  const keys = Object.keys(document);
  if (keys.length === 1 && keys[0] === "id") {
    return true;
  }

  const detailFields = [
    "company_name",
    "email_message",
    "website",
    "why_match",
    "industry",
    "contact_name",
    "contact_email",
    "contact_phone",
    "content",
  ];

  return !detailFields.some((field) => toCleanString(document[field]));
}

function toAssistantMatch(indexName: string, result: { document: SearchDoc; score?: number }): AssistantMatch | null {
  const id = toCleanString(result.document.id) ?? "n/a";
  const lowDetail = isLowDetailDocument(result.document);
  const fallbackSnippet =
    lowDetail
      ? "Matched by indexed terms, but detailed fields are not retrievable in this index schema."
      : resolveSnippet(result.document);

  return {
    index_name: indexName,
    id,
    score: Number.isFinite(result.score) ? Number(result.score) : null,
    title: resolveTitle(result.document),
    snippet: fallbackSnippet,
    company_name: toCleanString(result.document.company_name) ?? undefined,
    email_message: toCleanString(result.document.email_message) ?? undefined,
    website: toCleanString(result.document.website) ?? undefined,
    industry: toCleanString(result.document.industry) ?? undefined,
    why_match: toCleanString(result.document.why_match) ?? undefined,
    contact_name: toCleanString(result.document.contact_name) ?? undefined,
    contact_title: toCleanString(result.document.contact_title) ?? undefined,
    contact_email: toCleanString(result.document.contact_email) ?? undefined,
    contact_phone: toCleanString(result.document.contact_phone) ?? undefined,
    state: toCleanString(result.document.state) ?? undefined,
  };
}

function detectQuestionType(query: string):
  | "top_broker"
  | "email_message"
  | "website"
  | "industry"
  | "leadership"
  | "contact"
  | "why_match"
  | "state"
  | "generic" {
  const normalized = query.toLowerCase();
  if (
    normalized.includes("top") &&
    (normalized.includes("broker") || normalized.includes("brokers") || normalized.includes("agency"))
  ) {
    return "top_broker";
  }
  if (
    normalized.includes("email message") ||
    normalized.includes("outreach") ||
    normalized.includes("draft email") ||
    normalized.includes("email draft")
  ) {
    return "email_message";
  }
  if (normalized.includes("website") || normalized.includes("url") || normalized.includes("site")) {
    return "website";
  }
  if (normalized.includes("industry") || normalized.includes("segment") || normalized.includes("vertical")) {
    return "industry";
  }
  if (
    normalized.includes("contact") ||
    normalized.includes("email") ||
    normalized.includes("phone") ||
    normalized.includes("linkedin")
  ) {
    return "contact";
  }
  if (normalized.includes("why") || normalized.includes("match") || normalized.includes("fit")) {
    return "why_match";
  }
  if (normalized.includes("state") || normalized.includes("location")) {
    return "state";
  }
  if (normalized.includes("ceo") || normalized.includes("cfo") || normalized.includes("cto") || normalized.includes("president") || normalized.includes("founder") || normalized.includes("owner") || normalized.includes("who is")) {
    return "leadership";
  }
  return "generic";
}

function buildAnswer(query: string, matches: AssistantMatch[]): string | undefined {
  if (matches.length === 0) {
    return "I don't have information";
  }

  const top = matches[0];
  const company = top.company_name ?? top.title;
  const questionType = detectQuestionType(query);
  const normalizedQuery = query.toLowerCase();

  if (questionType === "top_broker") {
    const names = Array.from(
      new Set(
        matches
          .map((match) => match.company_name ?? match.title)
          .filter((name): name is string => Boolean(name && name.trim().length > 0))
      )
    ).slice(0, 5);

    if (names.length === 0) {
      return "I don't have information";
    }

    return names.join(", ");
  }

  if (questionType === "email_message") {
    if (top.email_message) {
      return `Suggested email message for ${company}: ${top.email_message}`;
    }
    return `I found ${company}, but email_message is not available in the indexed lead fields.`;
  }

  if (questionType === "website") {
    if (top.website) {
      return `The website for ${company} is ${top.website}.`;
    }
    return `I found ${company}, but website is not available in the indexed lead fields.`;
  }

  if (questionType === "industry") {
    if (top.industry) {
      return `The industry for ${company} is ${top.industry}.`;
    }
    return `I found ${company}, but industry is not retrievable from the current index schema (field retrievable=false).`;
  }

  if (questionType === "leadership") {
    const titleKeywords = ["ceo", "cfo", "cto", "president", "founder", "owner"];
    const requestedTitle = titleKeywords.find((keyword) => normalizedQuery.includes(keyword));

    const titleMatch = matches.find((match) => {
      if (!match.contact_title) {
        return false;
      }

      const normalizedTitle = match.contact_title.toLowerCase();
      if (requestedTitle) {
        return normalizedTitle.includes(requestedTitle);
      }

      return Boolean(match.contact_name && match.contact_title);
    });

    if (titleMatch?.contact_name && titleMatch.contact_title) {
      const titleCompany = titleMatch.company_name ?? titleMatch.title;
      return `${titleMatch.contact_name} is listed as ${titleMatch.contact_title} for ${titleCompany}.`;
    }

    return "I don't have information";
  }

  if (questionType === "contact") {
    const contactParts = [
      top.contact_name,
      top.contact_title,
      top.contact_email,
      top.contact_phone,
    ].filter((part): part is string => Boolean(part));

    if (contactParts.length > 0) {
      return `Contact details for ${company}: ${contactParts.join(" | ")}.`;
    }
    return `I found ${company}, but contact details are not retrievable from the current index schema (field retrievable=false).`;
  }

  if (questionType === "why_match") {
    if (top.why_match) {
      return `Why this lead matches (${company}): ${top.why_match}`;
    }
    return `I found ${company}, but why_match is not retrievable from the current index schema (field retrievable=false).`;
  }

  if (questionType === "state") {
    if (top.state) {
      return `${company} is indexed under state: ${top.state}.`;
    }
    return `I found ${company}, but state is not retrievable from the current index schema (field retrievable=false).`;
  }

  return `Top match: ${company}. ${top.snippet}`;
}

async function searchIndex(
  endpoint: string,
  apiKey: string,
  indexName: string,
  query: string,
  limit: number
): Promise<AssistantMatch[]> {
  const client = new SearchClient<SearchDoc>(
    endpoint,
    indexName,
    new AzureKeyCredential(apiKey)
  );

  const response = await client.search(query, {
    top: limit,
    includeTotalCount: true,
  });

  const matches: AssistantMatch[] = [];
  for await (const result of response.results) {
    const mapped = toAssistantMatch(indexName, result);
    if (mapped) {
      matches.push(mapped);
    }
  }

  return matches;
}

export async function POST(request: Request) {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const apiKey = process.env.AZURE_SEARCH_API_KEY;
  const enforcedIndex = toCleanString(process.env.AZURE_SEARCH_INDEX_NAME) ?? "customers-leads";

  if (!endpoint || !apiKey) {
    return NextResponse.json(
      {
        error: "Missing Azure AI Search settings. Required: AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_API_KEY",
      },
      { status: 500 }
    );
  }

  if (isPlaceholder(endpoint) || isPlaceholder(apiKey)) {
    return NextResponse.json(
      {
        error:
          "Azure AI Search settings still contain placeholder values. Update AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_API_KEY in web/.env.local and restart the Next.js server.",
      },
      { status: 500 }
    );
  }

  const body = (await request.json()) as AssistantRequest;
  const query = toCleanString(body.query) ?? "*";
  const limit = Number.isFinite(body.limit) ? Math.max(1, Math.min(Number(body.limit), 10)) : 5;

  try {
    const indexNames: string[] = [enforcedIndex];

    const allMatches: AssistantMatch[] = [];
    const skipped: string[] = [];

    for (const indexName of indexNames) {
      if (allMatches.length >= limit) {
        break;
      }

      try {
        const indexMatches = await searchIndex(
          endpoint,
          apiKey,
          indexName,
          query,
          Math.max(1, limit - allMatches.length)
        );
        allMatches.push(...indexMatches);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown index search error";
        if (
          isNonSearchableIndexErrorMessage(message) ||
          message.includes("not found") ||
          message.includes("404")
        ) {
          skipped.push(indexName);
          continue;
        }
        throw error;
      }
    }

    const answer = buildAnswer(query, allMatches);

    return NextResponse.json({
      query,
      searched_indexes: indexNames,
      skipped_indexes: skipped,
      matches: allMatches.slice(0, limit),
      answer,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Azure AI Search error";
    return NextResponse.json(
      {
        error: "Failed to retrieve lead assistant context from Azure AI Search.",
        detail: message,
      },
      { status: 502 }
    );
  }
}
