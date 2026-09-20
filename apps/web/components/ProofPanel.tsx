"use client";

import { useState } from "react";
import type { CampaignView } from "@/lib/view";

type ChainStatus =
  | { configured: false }
  | {
      configured: true;
      chainId: number;
      name: string;
      explorer: string | null;
      treasury: string;
    };

type Step = { step: string; detail: string; txUrl?: string; ok: boolean };

/**
 * The demo's closing argument: run one agent through the whole thing on a real chain, ending
 * with it asking for more money than it is allowed and being refused by the node.
 */
export function ProofPanel({
  chain,
  campaign,
  onDone,
}: {
  chain: ChainStatus;
  campaign: CampaignView;
  onDone: () => void;
}) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const candidate =
    campaign.agents.find((a) => a.isChampion) ??
    campaign.agents.find((a) => a.status === "alive");

  async function run() {
    setRunning(true);
    setFailed(null);
    setSteps(null);
    try {
      const res = await fetch("/api/prove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: candidate?.id }),
      });
      const data = await res.json();
      if (data.steps) setSteps(data.steps);
      if (!res.ok && !data.steps) setFailed(data.error ?? "The run stopped.");
      onDone();
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="band" style={{ paddingTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1.25rem" }}>Prove it on chain</h2>

      {!chain.configured ? (
        <p
          style={{
            color: "var(--ink-soft)",
            marginTop: "0.6rem",
            maxWidth: "62ch",
          }}
        >
          The simulation runs without a chain. To settle real transactions,
          deploy the contracts and put their addresses in <code>.env</code>,
          then restart the server.
        </p>
      ) : (
        <>
          <p
            style={{
              color: "var(--ink-soft)",
              marginTop: "0.6rem",
              maxWidth: "62ch",
            }}
          >
            Sends {candidate?.label ?? "an agent"} through the real sequence on{" "}
            {chain.name}: it asks the ad exchange for inventory, gets a 402,
            pays from its own wallet, collects the inventory — then tries to
            spend past its ceiling and gets refused.
          </p>

          <button
            type="button"
            className="press press-solid"
            disabled={running || !candidate}
            onClick={run}
            style={{ marginTop: "1rem" }}
          >
            {running ? "Settling on chain…" : "Run it on chain"}
          </button>

          {failed && (
            <p role="alert" style={{ color: "var(--dead)", marginTop: "1rem" }}>
              {failed}
            </p>
          )}

          {steps && (
            <ol
              style={{ listStyle: "none", margin: "1.25rem 0 0", padding: 0 }}
            >
              {steps.map((step, i) => (
                <li
                  key={`${step.step}-${i}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.4rem 1fr",
                    gap: "0.75rem",
                    padding: "0.7rem 0",
                    borderTop: "1px solid var(--rule)",
                  }}
                >
                  <svg
                    width={14}
                    height={14}
                    style={{ marginTop: 5 }}
                    aria-hidden="true"
                  >
                    <circle
                      cx={7}
                      cy={7}
                      r={5.5}
                      fill={step.ok ? "var(--alive)" : "none"}
                      stroke={step.ok ? "none" : "var(--dead)"}
                      strokeWidth={1.4}
                    />
                  </svg>
                  <div>
                    <div>{step.step}</div>
                    <div
                      className="tnum"
                      style={{
                        color: "var(--ink-soft)",
                        fontSize: 13,
                        marginTop: 2,
                      }}
                    >
                      {step.detail}
                    </div>
                    {step.txUrl && (
                      <a
                        href={step.txUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 13, color: "var(--ledger)" }}
                      >
                        See it in the explorer
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {chain.configured && chain.explorer && (
            <p style={{ marginTop: "1rem", fontSize: 13 }}>
              <a
                href={`${chain.explorer}/address/${chain.treasury}`}
                target="_blank"
                rel="noreferrer"
              >
                Open the treasury contract
              </a>
            </p>
          )}
        </>
      )}
    </section>
  );
}
