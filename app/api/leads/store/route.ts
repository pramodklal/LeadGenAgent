import { AzureKeyCredential, SearchClient, SearchIndexClient } from "@azure/search-documents";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function isPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("your-search-service") ||
    normalized.includes("your-azure-ai-search-admin-key") ||
    normalized.includes("your-")
  );
}

type LeadPayload = {
  company_name?: string;
  website?: string | null;
  email_message?: string | null;
  industry?: string | null;
  why_match?: string | null;
  contact_name?: string | null;
  contact_title?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  contact_linkedin?: string | null;
};

type StoreLeadsRequest = {
  state?: string;
  leads?: LeadPayload[];
};

type SearchLeadDocument = {
  id: string;
  company_name: string;
  email_message: string | null;
  industry: string | null;
  why_match: string | null;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_linkedin: string | null;
  state: string;
  stored_at: string;
};

type AssistantLeadDocument = SearchLeadDocument & {
  website: string | null;
  content: string;
};

type SearchFieldLike = {
  type?: string;
  searchable?: boolean;
};

function isNotFoundError(error: unknown): boolean {
  const candidate = error as { statusCode?: number; message?: string };
  return (
    candidate?.statusCode === 404 ||
    Boolean(
      typeof candidate?.message === "string" &&
      (candidate.message.includes("404") || candidate.message.toLowerCase().includes("not found"))
    )
  );
}

function hasSearchableStringField(index: { fields?: SearchFieldLike[] } | null | undefined): boolean {
  if (!index || !Array.isArray(index.fields)) {
    return false;
  }

  return index.fields.some((field) => field.type === "Edm.String" && field.searchable === true);
}

async function ensureIndexExists(endpoint: string, apiKey: string, indexName: string): Promise<void> {
  const indexClient = new SearchIndexClient(endpoint, new AzureKeyCredential(apiKey));

  try {
    await indexClient.getIndex(indexName);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("404") || error.message.includes("not found"))
    ) {
      const indexDef = {
        name: indexName,
        fields: [
          {
            name: "id",
            type: "Edm.String",
            key: true,
            searchable: false,
            filterable: true,
            sortable: false,
            facetable: false,
            retrievable: true,
          },
          {
            name: "company_name",
            type: "Edm.String",
            searchable: true,
            filterable: true,
            sortable: true,
            facetable: false,
            retrievable: true,
          },
          {
            name: "industry",
            type: "Edm.String",
            searchable: true,
            filterable: true,
            sortable: true,
            facetable: true,
            retrievable: true,
          },
          {
            name: "why_match",
            type: "Edm.String",
            searchable: true,
            filterable: false,
            sortable: false,
            facetable: false,
            retrievable: true,
          },
          {
            name: "contact_name",
            type: "Edm.String",
            searchable: true,
            filterable: true,
            sortable: true,
            facetable: false,
            retrievable: true,
          },
          {
            name: "contact_title",
            type: "Edm.String",
            searchable: true,
            filterable: true,
            sortable: true,
            facetable: false,
            retrievable: true,
          },
          {
            name: "contact_email",
            type: "Edm.String",
            searchable: true,
            filterable: true,
            sortable: true,
            facetable: false,
            retrievable: true,
          },
          {
            name: "contact_phone",
            type: "Edm.String",
            searchable: true,
            filterable: true,
            sortable: false,
            facetable: false,
            retrievable: true,
          },
          {
            name: "contact_linkedin",
            type: "Edm.String",
            searchable: true,
            filterable: false,
            sortable: false,
            facetable: false,
            retrievable: true,
          },
          {
            name: "state",
            type: "Edm.String",
            searchable: true,
            filterable: true,
            sortable: true,
            facetable: true,
            retrievable: true,
          },
          {
            name: "stored_at",
            type: "Edm.DateTimeOffset",
            searchable: false,
            filterable: true,
            sortable: true,
            facetable: false,
            retrievable: true,
          },
        ],
      };

      await indexClient.createIndex(indexDef as Parameters<typeof indexClient.createIndex>[0]);
    } else {
      throw error;
    }
  }
}

async function ensureAssistantIndexExists(endpoint: string, apiKey: string, indexName: string): Promise<void> {
  const indexClient = new SearchIndexClient(endpoint, new AzureKeyCredential(apiKey));

  try {
    await indexClient.getIndex(indexName);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("404") || error.message.includes("not found"))
    ) {
      const indexDef = {
        name: indexName,
        fields: [
          { name: "id", type: "Edm.String", key: true, searchable: false, filterable: true, sortable: false, facetable: false, retrievable: true },
          { name: "company_name", type: "Edm.String", searchable: true, filterable: true, sortable: true, facetable: false, retrievable: true },
          { name: "website", type: "Edm.String", searchable: true, filterable: false, sortable: false, facetable: false, retrievable: true },
          { name: "email_message", type: "Edm.String", searchable: true, filterable: true, sortable: true, facetable: true, retrievable: true },
          { name: "industry", type: "Edm.String", searchable: true, filterable: true, sortable: true, facetable: true, retrievable: true },
          { name: "why_match", type: "Edm.String", searchable: true, filterable: false, sortable: false, facetable: false, retrievable: true },
          { name: "contact_name", type: "Edm.String", searchable: true, filterable: true, sortable: true, facetable: false, retrievable: true },
          { name: "contact_title", type: "Edm.String", searchable: true, filterable: true, sortable: true, facetable: false, retrievable: true },
          { name: "contact_email", type: "Edm.String", searchable: true, filterable: true, sortable: true, facetable: false, retrievable: true },
          { name: "contact_phone", type: "Edm.String", searchable: true, filterable: true, sortable: false, facetable: false, retrievable: true },
          { name: "contact_linkedin", type: "Edm.String", searchable: true, filterable: false, sortable: false, facetable: false, retrievable: true },
          { name: "state", type: "Edm.String", searchable: true, filterable: true, sortable: true, facetable: true, retrievable: true },
          { name: "stored_at", type: "Edm.DateTimeOffset", searchable: false, filterable: true, sortable: true, facetable: false, retrievable: true },
          { name: "content", type: "Edm.String", searchable: true, filterable: false, sortable: false, facetable: false, retrievable: true },
        ],
      };

      await indexClient.createIndex(indexDef as Parameters<typeof indexClient.createIndex>[0]);
    } else {
      throw error;
    }
  }
}

async function resolveAssistantIndexName(
  endpoint: string,
  apiKey: string,
  preferredName: string
): Promise<string> {
  const indexClient = new SearchIndexClient(endpoint, new AzureKeyCredential(apiKey));

  try {
    const existing = await indexClient.getIndex(preferredName);
    if (hasSearchableStringField(existing as unknown as { fields?: SearchFieldLike[] })) {
      return preferredName;
    }

    const fallbackName = `${preferredName}-searchable`;
    await ensureAssistantIndexExists(endpoint, apiKey, fallbackName);
    return fallbackName;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("404") || error.message.includes("not found"))
    ) {
      await ensureAssistantIndexExists(endpoint, apiKey, preferredName);
      return preferredName;
    }

    throw error;
  }
}

function normalizeKeyPart(value: string | null | undefined): string {
  const normalized = (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "na";
}

function buildLeadDocumentId(lead: LeadPayload, state: string): string {
  const company = normalizeKeyPart(lead.company_name);
  const contact = normalizeKeyPart(lead.contact_email ?? lead.contact_name);
  const region = normalizeKeyPart(state);

  return `${region}-${company}-${contact}`.slice(0, 120);
}

function toSearchDocument(lead: LeadPayload, state: string, storedAt: string): SearchLeadDocument | null {
  const companyName = lead.company_name?.trim();
  if (!companyName) {
    return null;
  }

  const whyMatch = lead.why_match?.trim() || null;
  const emailMessage = lead.email_message?.trim() || null;

  return {
    id: buildLeadDocumentId(lead, state),
    company_name: companyName,
    email_message: emailMessage,
    industry: lead.industry?.trim() || null,
    why_match: whyMatch,
    contact_name: lead.contact_name?.trim() || null,
    contact_title: lead.contact_title?.trim() || null,
    contact_email: lead.contact_email?.trim() || null,
    contact_phone: lead.contact_phone?.trim() || null,
    contact_linkedin: lead.contact_linkedin?.trim() || null,
    state,
    stored_at: storedAt,
  };
}

function toAssistantDocument(document: SearchLeadDocument, website: string | null): AssistantLeadDocument {
  const content = [
    document.company_name,
    document.email_message,
    website,
    document.industry,
    document.why_match,
    document.contact_name,
    document.contact_title,
    document.contact_email,
    document.contact_phone,
    document.contact_linkedin,
    document.state,
  ]
    .filter((part) => typeof part === "string" && part.trim().length > 0)
    .join(" | ");

  return {
    ...document,
    website,
    content,
  };
}

async function documentExists(
  client: SearchClient<SearchLeadDocument>,
  id: string
): Promise<boolean> {
  try {
    await client.getDocument(id);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const apiKey = process.env.AZURE_SEARCH_API_KEY;
  const indexName = process.env.AZURE_SEARCH_INDEX_NAME;
  const assistantIndexBase = process.env.AZURE_SEARCH_ASSISTANT_INDEX_NAME ?? "leadgen-agent";

  if (!endpoint || !apiKey || !indexName) {
    return NextResponse.json(
      {
        error: "Missing Azure AI Search settings. Required: AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_API_KEY, AZURE_SEARCH_INDEX_NAME",
      },
      { status: 500 }
    );
  }

  if (isPlaceholder(endpoint) || isPlaceholder(apiKey) || isPlaceholder(indexName)) {
    return NextResponse.json(
      {
        error: "Azure AI Search settings still contain placeholder values. Update AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_API_KEY, and AZURE_SEARCH_INDEX_NAME in web/.env.local and restart the Next.js server.",
      },
      { status: 500 }
    );
  }

  if (isPlaceholder(assistantIndexBase)) {
    return NextResponse.json(
      {
        error: "Azure AI Search assistant index setting contains placeholder value. Update AZURE_SEARCH_ASSISTANT_INDEX_NAME in web/.env.local and restart the Next.js server.",
      },
      { status: 500 }
    );
  }

  const body = (await request.json()) as StoreLeadsRequest;
  const state = body.state?.trim();
  const leads = Array.isArray(body.leads) ? body.leads : [];

  if (!state) {
    return NextResponse.json({ error: "State is required." }, { status: 400 });
  }

  if (leads.length === 0) {
    return NextResponse.json({ error: "At least one lead is required." }, { status: 400 });
  }

  const storedAt = new Date().toISOString();
  const preparedLeads = leads
    .map((lead) => {
      const document = toSearchDocument(lead, state, storedAt);
      if (!document) {
        return null;
      }

      return {
        document,
        website: lead.website?.trim() || null,
      };
    })
    .filter(
      (item): item is { document: SearchLeadDocument; website: string | null } => item !== null
    );

  const documents = preparedLeads.map((item) => item.document);

  if (documents.length === 0) {
    return NextResponse.json({ error: "No valid leads to store." }, { status: 400 });
  }

  try {
    await ensureIndexExists(endpoint, apiKey, indexName);

    const client = new SearchClient<SearchLeadDocument>(
      endpoint,
      indexName,
      new AzureKeyCredential(apiKey)
    );

    const existenceMap = await Promise.all(
      documents.map((document) => documentExists(client, document.id))
    );

    const newPreparedLeads = preparedLeads.filter((_, idx) => !existenceMap[idx]);
    const newDocuments = newPreparedLeads.map((item) => item.document);
    const skippedExisting = documents.length - newDocuments.length;

    if (newDocuments.length === 0) {
      return NextResponse.json({
        stored: 0,
        skipped_existing: skippedExisting,
        assistant_index: assistantIndexBase,
        assistant_stored: 0,
        assistant_failed: 0,
      });
    }

    const result = await client.uploadDocuments(newDocuments);
    const failed = result.results.filter((item) => !item.succeeded);

    if (failed.length > 0) {
      return NextResponse.json(
        {
          error: "Some leads could not be stored in Azure AI Search.",
          stored: newDocuments.length - failed.length,
          failed: failed.length,
          skipped_existing: skippedExisting,
        },
        { status: 502 }
      );
    }

    const assistantDocuments = newPreparedLeads.map((item) =>
      toAssistantDocument(item.document, item.website)
    );

    try {
      const assistantIndexName = await resolveAssistantIndexName(
        endpoint,
        apiKey,
        assistantIndexBase
      );

      const assistantClient = new SearchClient<AssistantLeadDocument>(
        endpoint,
        assistantIndexName,
        new AzureKeyCredential(apiKey)
      );

      const assistantResult = await assistantClient.mergeOrUploadDocuments(assistantDocuments);
      const assistantFailed = assistantResult.results.filter((item) => !item.succeeded);

      return NextResponse.json({
        stored: newDocuments.length,
        skipped_existing: skippedExisting,
        assistant_index: assistantIndexName,
        assistant_stored: assistantDocuments.length - assistantFailed.length,
        assistant_failed: assistantFailed.length,
      });
    } catch (assistantError) {
      const assistantMessage = assistantError instanceof Error ? assistantError.message : "Unknown assistant index error";

      return NextResponse.json({
        stored: newDocuments.length,
        skipped_existing: skippedExisting,
        assistant_index: assistantIndexBase,
        assistant_stored: 0,
        assistant_failed: assistantDocuments.length,
        warning: `Leads were saved to ${indexName}, but assistant index write was skipped (${assistantMessage}).`,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Azure AI Search error";
    return NextResponse.json(
      {
        error: "Failed to store leads in Azure AI Search.",
        detail: message,
      },
      { status: 502 }
    );
  }
}