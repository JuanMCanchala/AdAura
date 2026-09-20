"use client";

import { useState } from "react";
import type { Genome } from "@/lib/genome";

export function BuyPanel({
  tracking,
  agentLabel,
  strategy,
  product,
}: {
  tracking: string;
  agentLabel: string;
  strategy: Genome;
  product: { name: string; priceUsd: number };
}) {
  const [state, setState] = useState<"idle" | "buying" | "bought" | "failed">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);

  async function buy() {
    setState("buying");
    const res = await fetch("/api/convert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tracking }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      setState("bought");
      setMessage(data.message ?? null);
    } else {
      setState("failed");
      setMessage(data.error ?? "The order did not go through.");
    }
  }

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "4rem 1rem" }}>
      <p style={{ color: "var(--ink-faint)", fontSize: 13, margin: 0 }}>
        You got here from {agentLabel}&rsquo;s{" "}
        {strategy.contentType.replace(/_/g, " ")} on{" "}
        {strategy.platform.replace(/_/g, " ")}
      </p>

      <h1 style={{ fontSize: "clamp(2rem, 6vw, 2.8rem)", marginTop: "0.5rem" }}>
        {product.name}
      </h1>

      <p className="tnum" style={{ fontSize: "1.6rem", marginTop: "0.75rem" }}>
        ${product.priceUsd.toFixed(2)}
      </p>

      {state === "bought" ? (
        <div
          className="band"
          style={{ marginTop: "2rem", paddingTop: "1.5rem" }}
        >
          <h2 style={{ fontSize: "1.3rem", color: "var(--alive)" }}>
            Order placed
          </h2>
          <p style={{ color: "var(--ink-soft)", marginTop: "0.5rem" }}>
            {message ?? `The sale was credited to ${agentLabel}.`}
          </p>
          <a
            href="/dashboard"
            style={{ display: "inline-block", marginTop: "1rem" }}
          >
            Back to the campaign
          </a>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="press press-solid"
            onClick={buy}
            disabled={state === "buying"}
            style={{ marginTop: "2rem" }}
          >
            {state === "buying" ? "Placing the order…" : "Buy it"}
          </button>

          {state === "failed" && message && (
            <p role="alert" style={{ color: "var(--dead)", marginTop: "1rem" }}>
              {message}
            </p>
          )}
        </>
      )}

      <p
        className="band"
        style={{
          color: "var(--ink-faint)",
          fontSize: 13,
          marginTop: "3rem",
          paddingTop: "1rem",
        }}
      >
        This is a test storefront. No payment is taken — the click is what
        matters, because it is what tells {agentLabel} whether its strategy was
        worth the money.
      </p>
    </main>
  );
}
