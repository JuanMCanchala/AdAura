"use client";

import { useMemo, useState } from "react";
import type { CampaignView } from "@/lib/view";

/**
 * Every ad the population has written, laid out the way an ad platform would show them.
 *
 * The point is a comparison a juror can make without reading code: the same product photo
 * under six different pitches, each one carrying the numbers it earned. Two agents that
 * differ only in tone and CTA end up with visibly different copy and visibly different ROI,
 * and the losing one has paused its own campaign.
 *
 * Every value here comes from campaign state. Nothing on this screen is written by the UI.
 */

type AgentView = CampaignView["agents"][number];
type CreativeView = AgentView["creatives"][number];

/** One publication, plus the agent that wrote it — what a card needs to render. */
type Entry = { agent: AgentView; creative: CreativeView; index: number };

type Sort = "newest" | "roi" | "conversions";
type StatusFilter = "all" | "active" | "paused" | "dead";

export function CreativeGallery({
  campaign,
  productImage,
}: {
  campaign: CampaignView;
  /** The uploaded product photo, shared by every publication. */
  productImage: string | null;
}) {
  const [agentId, setAgentId] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [open, setOpen] = useState<Entry | null>(null);

  const entries = useMemo(() => {
    const all: Entry[] = [];
    for (const agent of campaign.agents) {
      agent.creatives.forEach((creative, i) => {
        all.push({ agent, creative, index: i + 1 });
      });
    }

    const kept = all.filter(({ agent }) => {
      if (agentId !== "all" && agent.id !== agentId) return false;
      if (status === "all") return true;
      if (status === "dead") return agent.status === "dead";
      return agent.status === "alive" && agent.adCampaignStatus === status;
    });

    const sorted = [...kept];
    if (sort === "roi") sorted.sort((a, b) => b.agent.roi - a.agent.roi);
    else if (sort === "conversions")
      sorted.sort((a, b) => b.agent.conversions - a.agent.conversions);
    else sorted.sort((a, b) => b.creative.tick - a.creative.tick);
    return sorted;
  }, [campaign.agents, agentId, status, sort]);

  const withCreatives = campaign.agents.filter((a) => a.creatives.length > 0);

  return (
    <section className="band" style={{ paddingTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1.25rem" }}>Creative gallery</h2>
      <p
        style={{
          color: "var(--ink-soft)",
          marginTop: "0.6rem",
          maxWidth: "64ch",
        }}
      >
        Every ad the population has written, with what it earned. Same product, same photo —
        the copy and the results are the agents&rsquo; own.
      </p>
      <p style={{ color: "var(--ink-faint)", fontSize: 12, marginTop: "0.4rem" }}>
        Creative preview — local ad network. Nothing here is published to a real platform.
      </p>

      {withCreatives.length === 0 ? (
        <p style={{ color: "var(--ink-soft)", marginTop: "1.2rem" }}>
          No creatives yet. Run the pitch-off above and the agents will write their ads.
        </p>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              gap: "0.6rem",
              marginTop: "1rem",
              flexWrap: "wrap",
            }}
          >
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="all">All agents</option>
              {withCreatives.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              <option value="all">All campaigns</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="dead">Shut down</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="newest">Newest</option>
              <option value="roi">Best ROI</option>
              <option value="conversions">Most sales</option>
            </select>
            <span
              style={{
                color: "var(--ink-faint)",
                fontSize: 12,
                alignSelf: "center",
              }}
            >
              {entries.length} publication{entries.length === 1 ? "" : "s"}
            </span>
          </div>

          <ul
            style={{
              listStyle: "none",
              padding: 0,
              marginTop: "1.2rem",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: "1rem",
            }}
          >
            {entries.map((entry) => (
              <li key={`${entry.agent.id}-${entry.index}`}>
                <Card
                  entry={entry}
                  productImage={productImage}
                  onOpen={() => setOpen(entry)}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {open && (
        <Detail entry={open} productImage={productImage} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}

function roiColor(roi: number): string {
  return roi >= 0 ? "var(--gain, #2f7d55)" : "var(--loss, #b4462f)";
}

function pct(n: number): string {
  return `${n >= 0 ? "+" : ""}${Math.round(n * 100)}%`;
}

/** One ad, as a platform would preview it: image, copy, CTA, then what it earned. */
function Card({
  entry,
  productImage,
  onOpen,
}: {
  entry: Entry;
  productImage: string | null;
  onOpen: () => void;
}) {
  const { agent, creative, index } = entry;
  const image = creative.imageRef ?? productImage;
  const paused = agent.adCampaignStatus === "paused";
  const dead = agent.status === "dead";

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: 0,
        background: "transparent",
        border: "1px solid var(--rule, #d9d2c5)",
        cursor: "pointer",
        opacity: dead ? 0.62 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderBottom: "1px solid var(--rule, #d9d2c5)",
        }}
      >
        <strong>{agent.label}</strong>
        <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>
          {agent.genome.tone} · {String(agent.genome.audience).replace(/_/g, " ")}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: dead || paused ? "var(--ink-faint)" : "var(--gain, #2f7d55)",
          }}
        >
          {dead ? "shut down" : (agent.adCampaignStatus ?? "no campaign")}
        </span>
      </div>

      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          style={{
            display: "block",
            width: "100%",
            height: 150,
            objectFit: "cover",
            background: "var(--paper-sunk)",
          }}
        />
      ) : (
        <div
          style={{
            height: 150,
            background: "var(--paper-sunk)",
            display: "grid",
            placeItems: "center",
            color: "var(--ink-faint)",
            fontSize: 12,
          }}
        >
          no product photo
        </div>
      )}

      <div style={{ padding: "0.7rem 0.75rem" }}>
        <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{creative.headline}</div>
        <div
          style={{
            color: "var(--ink-soft)",
            fontSize: 13,
            marginTop: "0.35rem",
            lineHeight: 1.4,
          }}
        >
          {creative.body}
        </div>
        <div
          style={{
            display: "inline-block",
            marginTop: "0.6rem",
            padding: "0.25rem 0.6rem",
            border: "1px solid var(--rule-strong, #b9b0a0)",
            fontSize: 12,
          }}
        >
          {creative.cta}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
          padding: "0.55rem 0.75rem",
          borderTop: "1px solid var(--rule, #d9d2c5)",
          fontSize: 12,
          color: "var(--ink-soft)",
        }}
      >
        <span>#{index}</span>
        <span>{agent.clicks} clicks</span>
        <span>{agent.conversions} sales</span>
        <span style={{ marginLeft: "auto", color: roiColor(agent.roi) }}>
          {pct(agent.roi)}
        </span>
      </div>
    </button>
  );
}

/** The whole chain for one publication: strategy, campaign, tracking, money. */
function Detail({
  entry,
  productImage,
  onClose,
}: {
  entry: Entry;
  productImage: string | null;
  onClose: () => void;
}) {
  const { agent, creative, index } = entry;
  const image = creative.imageRef ?? productImage;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${agent.label} creative ${index}`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,18,15,0.55)",
        display: "grid",
        placeItems: "center",
        padding: "1rem",
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--paper, #fbf8f2)",
          border: "1px solid var(--rule-strong, #b9b0a0)",
          maxWidth: 620,
          width: "100%",
          maxHeight: "88vh",
          overflowY: "auto",
          padding: "1.1rem 1.25rem 1.4rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem" }}>
          <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
            {agent.label} · creative #{index}
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{ marginLeft: "auto", fontSize: 12 }}
          >
            Close
          </button>
        </div>

        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            style={{
              display: "block",
              width: "100%",
              maxHeight: 230,
              objectFit: "cover",
              marginTop: "0.8rem",
              border: "1px solid var(--rule, #d9d2c5)",
            }}
          />
        )}

        <p style={{ fontWeight: 600, marginTop: "0.9rem", marginBottom: 0 }}>
          {creative.headline}
        </p>
        <p style={{ color: "var(--ink-soft)", marginTop: "0.35rem" }}>{creative.body}</p>

        <Row label="Strategy" value={agent.strategy} />
        <Row label="Tone" value={agent.genome.tone} />
        <Row
          label="Audience"
          value={String(agent.genome.audience).replace(/_/g, " ")}
        />
        <Row label="Call to action" value={creative.cta} />
        <Row label="Written by" value={creative.source === "llm" ? "a model" : "template fallback"} />
        <Row label="Campaign" value={creative.adCampaignId ?? "not on a campaign yet"} />
        <Row
          label="Campaign status"
          value={agent.status === "dead" ? "shut down" : (agent.adCampaignStatus ?? "none")}
        />
        <Row label="Tracking id" value={agent.trackingId} />

        <h4 style={{ margin: "1.1rem 0 0.2rem", fontSize: "0.95rem" }}>Performance</h4>
        <Row label="Impressions" value={agent.impressions.toLocaleString()} />
        <Row label="Clicks" value={String(agent.clicks)} />
        <Row label="Sales" value={String(agent.conversions)} />
        <Row label="Spent" value={`$${agent.spentUsd.toFixed(2)}`} />
        <Row label="Earned" value={`$${agent.revenueUsd.toFixed(2)}`} />
        <Row label="Profit" value={`$${agent.profitUsd.toFixed(2)}`} />
        <Row label="ROI" value={pct(agent.roi)} color={roiColor(agent.roi)} />
        <Row
          label="Ad budget"
          value={`${Math.round(agent.budgetScale * 100)}% of its normal rate`}
        />

        {/* The same storefront a simulated click lands on — not a made-up URL. */}
        <a
          href={`/buy/${agent.trackingId}`}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "inline-block",
            marginTop: "1rem",
            padding: "0.35rem 0.7rem",
            border: "1px solid var(--rule-strong, #b9b0a0)",
            fontSize: 13,
          }}
        >
          Open the landing page this ad points at →
        </a>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "1rem",
        padding: "0.28rem 0",
        borderBottom: "1px solid var(--rule, #eee8dc)",
        fontSize: 13,
      }}
    >
      <span style={{ color: "var(--ink-faint)", minWidth: 132 }}>{label}</span>
      <span style={{ marginLeft: "auto", color, textAlign: "right" }}>{value}</span>
    </div>
  );
}
