"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const EXAMPLES = [
  {
    name: "Aurora Sleep Mask",
    priceUsd: 49,
    margin: 0.62,
    category: "wellness",
  },
  {
    name: "Cafetera Chemex 6 tazas",
    priceUsd: 82,
    margin: 0.45,
    category: "home",
  },
  {
    name: "Curso de fotografía nocturna",
    priceUsd: 180,
    margin: 0.85,
    category: "education",
  },
];

export function SetupForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState(EXAMPLES[0]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const populationSize = Number(form.get("populationSize"));
    const budgetUsd = Number(form.get("budgetUsd"));

    const res = await fetch("/api/campaign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        product: {
          name: form.get("name"),
          priceUsd: Number(form.get("priceUsd")),
          margin: Number(form.get("margin")) / 100,
          category: form.get("category"),
        },
        budgetUsd,
        populationSize,
        seed: form.get("seed") ? Number(form.get("seed")) : undefined,
      }),
    });

    if (!res.ok) {
      setError(
        (await res.json().catch(() => ({})))?.error ??
          "Could not start the campaign.",
      );
      setSubmitting(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "0 1rem 5rem" }}>
      <header style={{ paddingTop: "4rem", paddingBottom: "2rem" }}>
        <h1
          style={{ fontSize: "clamp(2.2rem, 6vw, 3.4rem)", maxWidth: "16ch" }}
        >
          Stop guessing which ad works
        </h1>
        <p
          style={{
            color: "var(--ink-soft)",
            marginTop: "1rem",
            maxWidth: "58ch",
          }}
        >
          Tell us what you are selling and how much you are willing to lose
          finding out. We put a population of agents on it — each one betting on
          a different strategy, each with its own wallet and a budget it cannot
          exceed. The ones that lose money are shut down. The ones that make
          money breed.
        </p>
        <p
          style={{
            color: "var(--ink-faint)",
            marginTop: "0.75rem",
            maxWidth: "58ch",
            fontSize: 14,
          }}
        >
          There are 40,500 strategies in the search space. Nobody has the budget
          to try them one at a time.
        </p>
      </header>

      <form
        onSubmit={onSubmit}
        className="band"
        style={{ paddingTop: "1.75rem" }}
      >
        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend
            style={{
              padding: 0,
              marginBottom: "1rem",
              fontSize: "1.15rem",
              fontFamily: "var(--font-display)",
            }}
          >
            What are you selling?
          </legend>

          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              flexWrap: "wrap",
              marginBottom: "1.25rem",
            }}
          >
            {EXAMPLES.map((example) => (
              <button
                key={example.name}
                type="button"
                className="press"
                style={{
                  fontSize: 13,
                  padding: "0.3rem 0.6rem",
                  borderColor:
                    product.name === example.name
                      ? "var(--ink)"
                      : "var(--rule-strong)",
                }}
                onClick={() => setProduct(example)}
              >
                {example.name}
              </button>
            ))}
          </div>

          <Field label="Product name" hint="Whatever your buyers call it.">
            <input
              name="name"
              required
              defaultValue={product.name}
              key={`n-${product.name}`}
            />
          </Field>

          <Row>
            <Field label="Price" hint="What a buyer pays.">
              <input
                name="priceUsd"
                type="number"
                min={1}
                step="0.01"
                required
                className="tnum"
                defaultValue={product.priceUsd}
                key={`p-${product.name}`}
              />
            </Field>
            <Field
              label="Margin %"
              hint="What is left after the cost of goods."
            >
              <input
                name="margin"
                type="number"
                min={1}
                max={100}
                required
                className="tnum"
                defaultValue={Math.round(product.margin * 100)}
                key={`m-${product.name}`}
              />
            </Field>
            <Field label="Category" hint="Shapes who is likely to buy.">
              <input
                name="category"
                required
                defaultValue={product.category}
                key={`c-${product.name}`}
              />
            </Field>
          </Row>
        </fieldset>

        <fieldset
          className="band"
          style={{
            border: "none",
            padding: "1.75rem 0 0",
            margin: "1.75rem 0 0",
          }}
        >
          <legend
            style={{
              padding: 0,
              marginBottom: "1rem",
              fontSize: "1.15rem",
              fontFamily: "var(--font-display)",
            }}
          >
            How much can they spend?
          </legend>

          <Row>
            <Field
              label="Campaign budget"
              hint="A hard ceiling. The contract will not let them past it."
            >
              <input
                name="budgetUsd"
                type="number"
                min={10}
                step={5000}
                required
                className="tnum"
                defaultValue={60000}
              />
            </Field>
            <Field
              label="Agents to start with"
              hint="Each one gets an equal share and its own wallet."
            >
              <input
                name="populationSize"
                type="number"
                min={2}
                max={12}
                required
                className="tnum"
                defaultValue={6}
              />
            </Field>
            <Field label="Seed" hint="Leave empty for a fresh market.">
              <input
                name="seed"
                type="number"
                className="tnum"
                placeholder="random"
              />
            </Field>
          </Row>
        </fieldset>

        {error && (
          <p
            role="alert"
            style={{ color: "var(--dead)", marginTop: "1.25rem" }}
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          className="press press-solid"
          disabled={submitting}
          style={{ marginTop: "1.75rem" }}
        >
          {submitting ? "Creating the first generation…" : "Start the campaign"}
        </button>
      </form>
    </main>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: "1rem",
      }}
    >
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: "1rem" }}>
      <span style={{ display: "block", marginBottom: "0.3rem" }}>{label}</span>
      {children}
      <span
        style={{
          display: "block",
          color: "var(--ink-faint)",
          fontSize: 13,
          marginTop: "0.3rem",
        }}
      >
        {hint}
      </span>
    </label>
  );
}
