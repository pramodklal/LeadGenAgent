"use client";

import { useMemo, useState } from "react";

import { FloatingChatWidget } from "@/components/FloatingChatWidget";
import { usStates } from "@/lib/usStates";

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
  discovered_companies?: PotentialCustomer[];
  tier?: "tier_1" | "tier_2" | "disqualified";
  fit_score?: number;
  outreach_angle?: string;
};

const fallbackCustomers: PotentialCustomer[] = [
  {
    company_name: "Summit Risk Partners",
    website: "https://example.com",
    industry: "MGA",
    why_match: "Multi-state operations with producer hierarchy and carrier program complexity."
  },
  {
    company_name: "Blue Ridge Distribution Group",
    website: "https://example.com",
    industry: "Insurance Network",
    why_match: "Agency network model with recruiting and contracting signals."
  }
];

export default function Page() {
  const pageSize = 25;
  const [selectedState, setSelectedState] = useState("Texas");
  const [distanceMiles, setDistanceMiles] = useState("150");
  const [customerLimit, setCustomerLimit] = useState("25");
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingToDb, setIsSavingToDb] = useState(false);
  const [customers, setCustomers] = useState<PotentialCustomer[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [resultSummary, setResultSummary] = useState("Run a search to load live potential customers.");

  const parsedDistance = useMemo(() => {
    const value = Number(distanceMiles);
    if (Number.isNaN(value) || value <= 0) {
      return 50;
    }
    return Math.min(value, 500);
  }, [distanceMiles]);

  const confidenceClassName = (confidence: PotentialCustomer["contact_confidence"]) => {
    if (confidence === "high") {
      return "confidence-chip confidence-high";
    }
    if (confidence === "medium") {
      return "confidence-chip confidence-medium";
    }
    if (confidence === "low") {
      return "confidence-chip confidence-low";
    }
    return "confidence-chip";
  };

  const parsedCustomerLimit = useMemo(() => {
    const value = Number(customerLimit);
    if (value === 50 || value === 75 || value === 100) {
      return value;
    }
    return 25;
  }, [customerLimit]);

  const totalPages = Math.max(1, Math.ceil(customers.length / pageSize));

  const pagedCustomers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return customers.slice(start, start + pageSize);
  }, [customers, currentPage]);

  const downloadCustomersCsv = () => {
    if (customers.length === 0) {
      return;
    }

    const headers = [
      "company_name",
      "industry",
      "contact_name",
      "contact_title",
      "contact_email",
      "contact_phone",
      "contact_linkedin",
      "website",
      "contact_confidence",
      "why_match",
    ];

    const escapeCsv = (value: string | null | undefined) => {
      const normalized = (value ?? "").replace(/\r?\n|\r/g, " ").trim();
      return `"${normalized.replace(/"/g, '""')}"`;
    };

    const rows = customers.map((customer) =>
      [
        customer.company_name,
        customer.industry,
        customer.contact_name,
        customer.contact_title,
        customer.contact_email,
        customer.contact_phone,
        customer.contact_linkedin,
        customer.website,
        customer.contact_confidence,
        customer.why_match,
      ]
        .map((field) => escapeCsv(field ?? null))
        .join(",")
    );

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `potential-customers-${selectedState.toLowerCase().replace(/\s+/g, "-")}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const findPotentialCustomers = async () => {
    setIsLoading(true);
    setCustomers([]);
    setCurrentPage(1);
    setResultSummary(`Searching live potential customers for ${selectedState} within ${parsedDistance} miles (limit ${parsedCustomerLimit})...`);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discovery_query: `Find US insurance networks, MGAs, and IMOs around ${selectedState}`,
          target_verticals: ["insurance_network", "mga", "imo"],
          geo_focus: `USA - ${selectedState}`,
          company_limit: parsedCustomerLimit,
          icp_constraints: [
            "multi-carrier distribution",
            "hierarchy and contracting complexity",
            `search radius preference ${parsedDistance} miles`
          ],
          successful_client_signals: [
            "commission reconciliation pain",
            "lead-to-policy visibility gaps"
          ],
          evidence_text: `User requested potential customers in ${selectedState} within ${parsedDistance} miles.`
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API request failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`);
      }

      const payload = (await response.json()) as AnalyzeResponse;
      const discovered = payload.discovered_companies ?? [];

      if (discovered.length > 0) {
        setCustomers(discovered);
        setCurrentPage(1);
        setResultSummary(
          `Found ${discovered.length} potential customers for ${selectedState} within ${parsedDistance} miles. Tier: ${payload.tier ?? "n/a"}, Fit score: ${payload.fit_score ?? "n/a"}.`
        );
      } else {
        setCustomers([]);
        setResultSummary(
          `No live results returned for ${selectedState} within ${parsedDistance} miles.`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setCustomers([]);
      setResultSummary(
        `Could not load live results (${message}). Please verify endpoint reachability and retry.`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const addCustomersToDb = async () => {
    if (customers.length === 0) {
      return;
    }

    setIsSavingToDb(true);
    setResultSummary(`Storing ${customers.length} potential customers for ${selectedState} in Azure AI Search...`);

    try {
      const response = await fetch("/api/leads/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: selectedState,
          leads: customers,
        }),
      });

      const payload = (await response.json()) as {
        stored?: number;
        skipped_existing?: number;
        assistant_index?: string;
        assistant_stored?: number;
        assistant_failed?: number;
        error?: string;
        detail?: string;
      };

      if (!response.ok) {
        const apiDetail = payload.detail?.trim();
        const apiError = payload.error?.trim();
        throw new Error(apiDetail || apiError || `Request failed with status ${response.status}`);
      }

      const stored = payload.stored ?? customers.length;
      const skippedExisting = payload.skipped_existing ?? 0;
      const assistantStored = payload.assistant_stored;
      const assistantFailed = payload.assistant_failed;
      const assistantIndex = payload.assistant_index;

      if (stored === 0 && skippedExisting > 0) {
        setResultSummary(
          `No new records added. ${skippedExisting} potential customers already exist in Azure AI Search for ${selectedState}.`
        );
        return;
      }

      if (typeof assistantStored === "number" && assistantIndex) {
        setResultSummary(
          `Record added succeesfuly. Stored ${stored} potential customers for ${selectedState} in Azure AI Search${skippedExisting > 0 ? ` (skipped ${skippedExisting} existing)` : ""}. Assistant index ${assistantIndex}: stored ${assistantStored}${typeof assistantFailed === "number" ? `, failed ${assistantFailed}` : ""}.`
        );
      } else {
        setResultSummary(`Record added succeesfuly. Stored ${stored} potential customers for ${selectedState} in Azure AI Search${skippedExisting > 0 ? ` (skipped ${skippedExisting} existing)` : ""}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const duplicateHint = 'Record already avaiable in index "customers-leads".';
      setResultSummary(`Could not store customers in Azure AI Search (${message}). ${duplicateHint}`);
    } finally {
      setIsSavingToDb(false);
    }
  };

  return (
    <main className="page-wrap">
      <div className="container">
        <section className="hero">
          <h1>Insurance Lead Intelligence Generator</h1>
          <p>
            Discover potential customers by USA state and mile radius, then prioritize networks,
            Managing General Agents (MGAs), and Independent Marketing Organizations (IMOs) with contextual outreach support.
          </p>
        </section>

        <section className="dashboard-grid">
          <div className="panel">
            <h2>Search Interface</h2>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="state">Select USA State</label>
                <select
                  id="state"
                  value={selectedState}
                  onChange={(event) => {
                    const nextState = event.target.value;
                    setSelectedState(nextState);
                    setCustomers([]);
                    setCurrentPage(1);
                    setResultSummary(`Selection updated to ${nextState}. Click Find Potential Customers to load live results.`);
                  }}
                >
                  {usStates.map((state) => (
                    <option value={state} key={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </div>

              <div className="inline-fields">
                <div className="field">
                  <label htmlFor="miles">Distance (miles)</label>
                  <input
                    id="miles"
                    type="number"
                    min={1}
                    max={500}
                    value={distanceMiles}
                    onChange={(event) => {
                      const nextDistance = event.target.value;
                      setDistanceMiles(nextDistance);
                      setCustomers([]);
                      setCurrentPage(1);
                      setResultSummary("Distance updated. Click Find Potential Customers to load live results.");
                    }}
                  />
                </div>
                <div className="field quick-radius-field">
                  <label htmlFor="distance-slider">Quick Radius</label>
                  <input
                    id="distance-slider"
                    type="range"
                    min={10}
                    max={500}
                    step={10}
                    value={parsedDistance}
                    onChange={(event) => {
                      const nextDistance = event.target.value;
                      setDistanceMiles(nextDistance);
                      setCustomers([]);
                      setCurrentPage(1);
                      setResultSummary("Distance updated. Click Find Potential Customers to load live results.");
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="customer-limit">Customer Count</label>
                  <select
                    id="customer-limit"
                    value={customerLimit}
                    onChange={(event) => {
                      const nextLimit = event.target.value;
                      setCustomerLimit(nextLimit);
                      setCustomers([]);
                      setCurrentPage(1);
                      setResultSummary(`Customer count updated to ${nextLimit}. Click Find Potential Customers to load live results.`);
                    }}
                  >
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="75">75</option>
                    <option value="100">100</option>
                  </select>
                </div>
              </div>

              <div className="cta-row">
                <button className="btn btn-primary" type="button" onClick={findPotentialCustomers}>
                  {isLoading ? "Searching..." : "Find Potential Customers"}
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    setSelectedState("Texas");
                    setDistanceMiles("150");
                    setCustomerLimit("25");
                    setCustomers([]);
                    setCurrentPage(1);
                    setResultSummary("Filters reset. Click Find Potential Customers to load live results.");
                  }}
                >
                  Reset
                </button>
              </div>

              <div className="cta-row">
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={downloadCustomersCsv}
                  disabled={isLoading || customers.length === 0}
                >
                  Download Potential Customers
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={addCustomersToDb}
                  disabled={isLoading || isSavingToDb || customers.length === 0}
                >
                  {isSavingToDb ? "Adding..." : "Add Potential Customer"}
                </button>
              </div>
            </div>
          </div>

          <div className="panel">
            <h2>Potential Customers</h2>
            <p
              className={`note result-summary ${isLoading ? "result-summary-searching" : ""} ${!isLoading && resultSummary.startsWith("Found ") ? "result-summary-found" : ""} ${!isLoading && resultSummary.includes("Could not store customers in Azure AI Search") ? "result-summary-store-error" : ""} ${!isLoading && resultSummary.includes("Record added succeesfuly") ? "result-summary-store-success" : ""}`}
            >
              {resultSummary}
            </p>
            <div className="table-wrap">
              <table className="customers-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Industry</th>
                    <th>Contact</th>
                    <th>Why Match</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={4}>No live customer rows to display.</td>
                    </tr>
                  ) : pagedCustomers.map((customer) => (
                    <tr key={`${customer.company_name}-${customer.website ?? "na"}`}>
                      <td>
                        <div className="table-company">{customer.company_name}</div>
                        <span className="badge">ICP Match Candidate</span>
                      </td>
                      <td>{customer.industry ?? "Insurance"}</td>
                      <td>
                        <div className="contact-line">{customer.contact_name ?? "-"}</div>
                        <div className="contact-line">{customer.contact_title ?? "-"}</div>
                        <div className="contact-line">{customer.contact_email ?? "-"}</div>
                        <div className="contact-line">{customer.contact_phone ?? "-"}</div>
                        {customer.contact_linkedin ? (
                          <a className="contact-line" href={customer.contact_linkedin} target="_blank" rel="noreferrer">
                            LinkedIn
                          </a>
                        ) : (
                          <div className="contact-line">-</div>
                        )}
                        {customer.website ? (
                          <a className="contact-line" href={customer.website} target="_blank" rel="noreferrer">
                            {customer.website}
                          </a>
                        ) : (
                          <div className="contact-line">-</div>
                        )}
                        {customer.contact_confidence ? (
                          <div className={confidenceClassName(customer.contact_confidence)}>
                            {`Confidence: ${customer.contact_confidence}`}
                          </div>
                        ) : null}
                      </td>
                      <td>{customer.why_match ?? "Signal data pending enrichment."}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {customers.length > pageSize ? (
                <div className="pagination-row">
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </button>
                  <span className="note">Page {currentPage} of {totalPages}</span>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>

      <div className="page-credit">Design &amp; Developed by Code Insights</div>

      <FloatingChatWidget />
    </main>
  );
}
