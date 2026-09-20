"use client";

import { useCallback, useEffect, useState } from "react";
import { LineageStrip } from "./LineageStrip";
import { PopulationTable } from "./PopulationTable";
import { ProofPanel } from "./ProofPanel";
import { DEATH_REASONS, type CampaignView, money, percent } from "@/lib/view";

type ChainStatus =
  | { configured: false }
  | {
      configured: true;
      chainId: number;
      name: string;
      explorer: string | null;
      treasury: string;
    };

export function Dashboard() {
  const [campaign, setCampaign] = useState<CampaignView | null>(null);
  const [chain, setChain] = useState<ChainStatus>({ configured: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/campaign", { cache: "no-store" });
    const data = await res.json();
    setCampaign(data.campaign);
    setChain(data.chain);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = useCallback(
    async (label: string, run: () => Promise<Response>) => {
      setBusy(label);
      setError(null);
      try {
        const res = await run();
        if (!res.ok)
          setError(
            (await res.json().catch(() => ({})))?.error ?? "That did not work.",
          );
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  if (!campaign) {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "4rem 1rem" }}>
        <h1 style={{ fontSize: "2rem" }}>No campaign running</h1>
        <p style={{ color: "var(--ink-soft)", marginTop: "0.75rem" }}>
          Set up a product and a budget, and the first generation of agents
          starts trading.
        </p>
        <a
          href="/"
          className="press press-solid"
          style={{ display: "inline-block", marginTop: "1.5rem" }}
        >
          Set up a campaign
        </a>
      </main>
    );
  }

  const spentShare =
    campaign.globalCapUsd === 0 ? 0 : campaign.spentUsd / campaign.globalCapUsd;
  const champion = campaign.agents.find((a) => a.isChampion) ?? null;

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "0 1rem 5rem" }}>
      <header style={{ paddingTop: "2.5rem", paddingBottom: "1.75rem" }}>
        <p style={{ color: "var(--ink-faint)", fontSize: 13, margin: 0 }}>
          Day {campaign.tick} of selling {campaign.productName} at $
          {campaign.priceUsd.toFixed(0)}
        </p>
        <h1
          style={{
            fontSize: "clamp(1.9rem, 5vw, 3rem)",
            marginTop: "0.4rem",
            maxWidth: "18ch",
          }}
        >
          Generation {campaign.generation}
        </h1>
        <p
          style={{
            color: "var(--ink-soft)",
            marginTop: "0.6rem",
            maxWidth: "58ch",
          }}
        >
          {campaign.alive} agents are still trading and {campaign.dead} have
          been shut down, out of {campaign.total} ever created. None of them was
          told which strategy works.
        </p>
      </header>

      <section
        className="band"
        style={{ paddingTop: "1.5rem", paddingBottom: "2rem" }}
      >
        <LineageStrip
          agents={campaign.agents}
          generation={campaign.generation}
          selectedId={hovered}
          onSelect={setHovered}
        />
      </section>

      <section
        className="band"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "1.5rem",
          padding: "1.5rem 0",
        }}
      >
        <Figure
          label="Spent"
          value={money(campaign.spentUsd)}
          note={`of ${money(campaign.globalCapUsd)} allowed`}
        />
        <Figure
          label="Earned"
          value={money(campaign.revenueUsd)}
          note={`${campaign.conversions} sales`}
        />
        <Figure
          label="Profit"
          value={money(campaign.profitUsd, true)}
          note={
            campaign.spentUsd > 0
              ? `${percent(campaign.roi)} return`
              : "nothing spent yet"
          }
          tone={campaign.profitUsd >= 0 ? "alive" : "dead"}
        />
        <Figure
          label="Best earner"
          value={champion ? champion.label : "—"}
          note={
            champion
              ? `${money(champion.profitUsd, true)} on ${champion.genome.platform}`
              : "nobody is up yet"
          }
          tone="sulfur"
        />
      </section>

      <section className="band" style={{ padding: "1.25rem 0" }}>
        <CapBar
          share={spentShare}
          spent={campaign.spentUsd}
          cap={campaign.globalCapUsd}
        />
      </section>

      {error && (
        <p
          role="alert"
          style={{
            color: "var(--dead)",
            borderLeft: "2px solid var(--dead)",
            paddingLeft: "0.75rem",
            margin: "1rem 0",
          }}
        >
          {error}
        </p>
      )}

      <section
        className="band"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.6rem",
          alignItems: "center",
          padding: "1.25rem 0",
        }}
      >
        <button
          type="button"
          className="press press-solid"
          disabled={busy !== null || campaign.paused}
          onClick={() =>
            act("tick", () => fetch("/api/tick?ticks=1", { method: "POST" }))
          }
        >
          {busy === "tick" ? "Trading…" : "Run one day"}
        </button>
        <button
          type="button"
          className="press"
          disabled={busy !== null || campaign.paused}
          onClick={() =>
            act("week", () => fetch("/api/tick?ticks=6", { method: "POST" }))
          }
        >
          {busy === "week" ? "Trading…" : "Run six days"}
        </button>
        <button
          type="button"
          className="press"
          disabled={busy !== null}
          onClick={() =>
            act("pause", () =>
              fetch("/api/control", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  action: campaign.paused ? "resume" : "pause",
                }),
              }),
            )
          }
        >
          {campaign.paused ? "Resume the campaign" : "Stop everything"}
        </button>

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            marginLeft: "auto",
          }}
        >
          <span
            style={{
              color: "var(--ink-soft)",
              fontSize: 13,
              whiteSpace: "nowrap",
            }}
          >
            Spending cap
          </span>
          <input
            type="number"
            defaultValue={campaign.globalCapUsd}
            min={0}
            step={5}
            style={{ width: 110 }}
            className="tnum"
            onBlur={(e) => {
              const capUsd = Number(e.currentTarget.value);
              if (capUsd === campaign.globalCapUsd) return;
              act("cap", () =>
                fetch("/api/control", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ action: "setGlobalCap", capUsd }),
                }),
              );
            }}
          />
        </label>
      </section>

      {campaign.paused && (
        <p style={{ color: "var(--dead)", margin: "0 0 1rem" }}>
          Every agent is frozen. On chain this is the same owner-only pause that
          makes <code>spend()</code> revert.
        </p>
      )}

      <PopulationTable
        agents={campaign.agents}
        hovered={hovered}
        onHover={setHovered}
        busy={busy !== null}
        explorer={chain.configured ? chain.explorer : null}
        onKill={(agentId) =>
          act("kill", () =>
            fetch("/api/control", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "kill", agentId }),
            }),
          )
        }
      />

      <ProofPanel chain={chain} campaign={campaign} onDone={refresh} />

      <section className="band" style={{ paddingTop: "1.5rem" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>
          What happened
        </h2>
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {campaign.events.map((event, i) => (
            <li
              key={`${event.at}-${i}`}
              className="hairline"
              style={{
                display: "flex",
                gap: "1rem",
                padding: "0.5rem 0",
                fontSize: 14,
              }}
            >
              <span
                className="tnum"
                style={{ color: "var(--ink-faint)", minWidth: "3.5rem" }}
              >
                day {event.tick}
              </span>
              <span
                style={{
                  color:
                    event.kind === "death"
                      ? "var(--dead)"
                      : event.kind === "birth"
                        ? "var(--alive)"
                        : event.kind === "chain"
                          ? "var(--ledger)"
                          : "var(--ink)",
                }}
              >
                {event.message}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <footer
        className="band"
        style={{
          marginTop: "2rem",
          paddingTop: "1.25rem",
          color: "var(--ink-faint)",
          fontSize: 13,
        }}
      >
        Agents are shut down when they {DEATH_REASONS.unprofitable}. Their
        unspent budget returns to the campaign, and the survivors breed into it.
      </footer>
    </main>
  );
}

function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "alive" | "dead" | "sulfur";
}) {
  const color = tone ? `var(--${tone})` : "var(--ink)";
  return (
    <div>
      <div style={{ color: "var(--ink-faint)", fontSize: 13 }}>{label}</div>
      <div
        className="tnum"
        style={{
          fontSize: "1.6rem",
          color,
          marginTop: "0.2rem",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div
        style={{ color: "var(--ink-soft)", fontSize: 13, marginTop: "0.15rem" }}
      >
        {note}
      </div>
    </div>
  );
}

/** The one number the person funding this actually cares about. */
function CapBar({
  share,
  spent,
  cap,
}: {
  share: number;
  spent: number;
  cap: number;
}) {
  const pct = Math.min(1, Math.max(0, share));
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 13,
          marginBottom: "0.4rem",
        }}
      >
        <span style={{ color: "var(--ink-soft)" }}>
          The population cannot spend past {money(cap)} — the contract reverts,
          not the dashboard.
        </span>
        <span className="tnum" style={{ color: "var(--ink-faint)" }}>
          {money(spent)} used
        </span>
      </div>
      <div
        style={{
          height: 8,
          background: "var(--paper-sunk)",
          border: "1px solid var(--rule)",
        }}
        role="meter"
        aria-valuenow={Math.round(pct * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Share of the campaign cap already spent"
      >
        <div
          style={{
            width: `${pct * 100}%`,
            height: "100%",
            background: "var(--ledger)",
          }}
        />
      </div>
    </div>
  );
}
