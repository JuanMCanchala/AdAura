"use client";

import { useState } from "react";
import { type AgentView, DEATH_REASONS, money, percent } from "@/lib/view";

type Props = {
  agents: AgentView[];
  hovered: string | null;
  onHover: (id: string | null) => void;
  onKill: (agentId: string) => void;
  busy: boolean;
  explorer: string | null;
};

export function PopulationTable({
  agents,
  hovered,
  onHover,
  onKill,
  busy,
  explorer,
}: Props) {
  const [showDead, setShowDead] = useState(false);
  const living = agents.filter((a) => a.status === "alive");
  const dead = agents.filter((a) => a.status === "dead");
  const rows = showDead ? [...living, ...dead] : living;

  const ordered = [...rows].sort((a, b) => {
    if (a.status !== b.status) return a.status === "alive" ? -1 : 1;
    return b.profitUsd - a.profitUsd;
  });

  return (
    <section className="band" style={{ paddingTop: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        <h2 style={{ fontSize: "1.25rem" }}>Who is trading</h2>
        <button
          type="button"
          onClick={() => setShowDead((v) => !v)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--ink-soft)",
            fontSize: 13,
            padding: 0,
          }}
        >
          {showDead
            ? "Hide the ones that were shut down"
            : `Show the ${dead.length} that were shut down`}
        </button>
      </div>

      <div style={{ overflowX: "auto", marginTop: "0.75rem" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 14,
            minWidth: 720,
          }}
        >
          <caption
            style={{
              captionSide: "top",
              textAlign: "left",
              fontSize: 12,
              color: "var(--ink-faint)",
              paddingBottom: "0.5rem",
            }}
          >
            Ad delivery is a local simulation. The campaign lifecycle, tracking, spend,
            revenue and the agents&rsquo; own budget decisions are real application logic.
          </caption>
          <thead>
            <tr style={{ color: "var(--ink-faint)", textAlign: "left" }}>
              <Th>Agent</Th>
              <Th>Strategy it is betting on</Th>
              <Th align="right">Spent</Th>
              <Th align="right">Earned</Th>
              <Th align="right">Profit</Th>
              <Th align="right">Sales</Th>
              <Th>Ad campaign</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {ordered.map((agent) => {
              const isDead = agent.status === "dead";
              return (
                <tr
                  key={agent.id}
                  className="hairline"
                  onMouseEnter={() => onHover(agent.id)}
                  onMouseLeave={() => onHover(null)}
                  style={{
                    background:
                      hovered === agent.id
                        ? "var(--paper-sunk)"
                        : "transparent",
                    opacity: isDead ? 0.55 : 1,
                  }}
                >
                  <Td>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.45rem",
                      }}
                    >
                      <svg width={12} height={12} aria-hidden="true">
                        <circle
                          cx={6}
                          cy={6}
                          r={4.5}
                          fill={isDead ? "none" : "var(--alive)"}
                          stroke={isDead ? "var(--dead)" : "none"}
                          strokeWidth={1.3}
                        />
                      </svg>
                      <strong style={{ fontWeight: 600 }}>{agent.label}</strong>
                      {agent.isChampion && (
                        <span
                          style={{ color: "var(--sulfur)", fontSize: 12 }}
                          title="Best earner"
                        >
                          best
                        </span>
                      )}
                    </span>
                    {explorer && agent.address && (
                      <a
                        href={`${explorer}/address/${agent.address}`}
                        target="_blank"
                        rel="noreferrer"
                        className="tnum"
                        style={{
                          display: "block",
                          fontSize: 11,
                          color: "var(--ledger)",
                          marginTop: 2,
                        }}
                      >
                        {agent.address.slice(0, 10)}…
                      </a>
                    )}
                  </Td>
                  <Td>
                    <span>{agent.strategy}</span>
                    {agent.mutatedGenes.length > 0 && (
                      <span
                        style={{
                          display: "block",
                          fontSize: 12,
                          color: "var(--ink-faint)",
                          marginTop: 2,
                        }}
                      >
                        inherited from{" "}
                        {agent.parentId
                          ? labelOf(agents, agent.parentId)
                          : "nobody"}
                        , changed {agent.mutatedGenes.join(" and ")}
                      </span>
                    )}
                    {isDead && agent.deathReason && (
                      <span
                        style={{
                          display: "block",
                          fontSize: 12,
                          color: "var(--dead)",
                          marginTop: 2,
                        }}
                      >
                        {DEATH_REASONS[agent.deathReason] ?? agent.deathReason}
                      </span>
                    )}
                  </Td>
                  <Td align="right" numeric>
                    {money(agent.spentUsd)}
                  </Td>
                  <Td align="right" numeric>
                    {money(agent.revenueUsd)}
                  </Td>
                  <Td align="right" numeric>
                    <span
                      style={{
                        color:
                          agent.profitUsd >= 0 ? "var(--alive)" : "var(--dead)",
                      }}
                    >
                      {money(agent.profitUsd, true)}
                    </span>
                    {agent.spentUsd > 0 && (
                      <span
                        style={{
                          display: "block",
                          fontSize: 12,
                          color: "var(--ink-faint)",
                        }}
                      >
                        {percent(agent.roi)}
                      </span>
                    )}
                  </Td>
                  <Td align="right" numeric>
                    {agent.conversions}
                  </Td>
                  <Td>
                    {agent.adCampaignId ? (
                      <>
                        <span
                          style={{
                            color:
                              agent.adCampaignStatus === "active"
                                ? "var(--gain)"
                                : "var(--ink-faint)",
                          }}
                        >
                          {agent.adCampaignStatus}
                        </span>
                        <span
                          style={{
                            display: "block",
                            fontSize: 12,
                            color: "var(--ink-faint)",
                            marginTop: 2,
                          }}
                        >
                          budget {Math.round(agent.budgetScale * 100)}%
                        </span>
                      </>
                    ) : (
                      <span style={{ color: "var(--ink-faint)" }}>—</span>
                    )}
                  </Td>
                  <Td align="right">
                    {!isDead && (
                      <div
                        style={{
                          display: "flex",
                          gap: "0.4rem",
                          justifyContent: "flex-end",
                          alignItems: "center",
                        }}
                      >
                        <a
                          href={`/buy/${agent.trackingId}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: 13, whiteSpace: "nowrap" }}
                          title={`Open the storefront ${agent.label} is sending traffic to`}
                        >
                          Its landing
                        </a>
                        <button
                          type="button"
                          className="press"
                          disabled={busy}
                          style={{ padding: "0.25rem 0.55rem", fontSize: 13 }}
                          onClick={() => onKill(agent.id)}
                        >
                          Shut down
                        </button>
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
            {ordered.length === 0 && (
              <tr>
                <Td>Nothing is trading. Every agent was shut down.</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function labelOf(agents: AgentView[], id: string): string {
  return agents.find((a) => a.id === id)?.label ?? id;
}

function Th({
  children,
  align = "left",
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className="hairline"
      style={{
        textAlign: align,
        fontWeight: 400,
        padding: "0.35rem 0.6rem 0.5rem 0",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  numeric = false,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  numeric?: boolean;
}) {
  return (
    <td
      className={numeric ? "tnum" : undefined}
      style={{
        textAlign: align,
        padding: "0.6rem 0.6rem 0.6rem 0",
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  );
}
