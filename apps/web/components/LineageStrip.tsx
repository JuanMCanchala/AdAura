"use client";

import type { AgentView } from "@/lib/view";

/**
 * The population as a living thing over time.
 *
 * One column per generation, one mark per agent. A filled chlorophyll disc is an agent that
 * is alive and its area is its profit; a hollow iron-oxide ring is one that was shut down.
 * Hairlines join a child to its parent. Read left to right you see the search: early columns
 * are scattered and dim, later ones cluster around whatever turned out to work.
 */

type Props = {
  agents: AgentView[];
  generation: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

const ROW = 34;
const COL = 96;
const PAD = { top: 34, left: 22, right: 96, bottom: 16 };

export function LineageStrip({
  agents,
  generation,
  selectedId,
  onSelect,
}: Props) {
  const columns = generation + 1;
  const byGeneration = new Map<number, AgentView[]>();
  for (const a of agents) {
    const list = byGeneration.get(a.generation) ?? [];
    list.push(a);
    byGeneration.set(a.generation, list);
  }

  // Lay each generation out in its own column, ordered so siblings sit near their parent.
  const pos = new Map<string, { x: number; y: number }>();
  let maxRow = 0;
  for (let g = 0; g < columns; g++) {
    const inGen = (byGeneration.get(g) ?? []).sort((a, b) => {
      const pa = a.parentId ? (pos.get(a.parentId)?.y ?? 0) : 0;
      const pb = b.parentId ? (pos.get(b.parentId)?.y ?? 0) : 0;
      return pa - pb || a.id.localeCompare(b.id);
    });
    inGen.forEach((agent, row) => {
      pos.set(agent.id, { x: PAD.left + g * COL, y: PAD.top + row * ROW });
      maxRow = Math.max(maxRow, row);
    });
  }

  const width = PAD.left + columns * COL + PAD.right;
  const height = PAD.top + (maxRow + 1) * ROW + PAD.bottom;

  const peakProfit = Math.max(1, ...agents.map((a) => Math.abs(a.profitUsd)));
  const radius = (a: AgentView) =>
    4 + Math.sqrt(Math.abs(a.profitUsd) / peakProfit) * 8;

  return (
    <figure style={{ margin: 0, overflowX: "auto" }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Lineage of ${agents.length} agents across ${columns} generations`}
        style={{ display: "block", minWidth: "100%" }}
      >
        <title>
          Every agent ever created, joined to its parent, sized by profit
        </title>

        {Array.from({ length: columns }, (_, g) => (
          <g key={g}>
            <line
              x1={PAD.left + g * COL}
              y1={PAD.top - 16}
              x2={PAD.left + g * COL}
              y2={height - PAD.bottom}
              stroke="var(--rule)"
              strokeWidth={1}
            />
            <text
              x={PAD.left + g * COL}
              y={PAD.top - 22}
              fill="var(--ink-faint)"
              fontSize={11}
              textAnchor="middle"
              className="tnum"
            >
              {g}
            </text>
          </g>
        ))}

        {agents.map((agent) => {
          const to = pos.get(agent.id);
          const from = agent.parentId ? pos.get(agent.parentId) : null;
          if (!to || !from) return null;
          const mid = (from.x + to.x) / 2;
          return (
            <path
              key={`edge-${agent.id}`}
              d={`M ${from.x} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${to.x} ${to.y}`}
              fill="none"
              stroke={
                selectedId &&
                (selectedId === agent.id || selectedId === agent.parentId)
                  ? "var(--ink)"
                  : "var(--rule-strong)"
              }
              strokeWidth={
                selectedId &&
                (selectedId === agent.id || selectedId === agent.parentId)
                  ? 1.6
                  : 1
              }
            />
          );
        })}

        {agents.map((agent) => {
          const p = pos.get(agent.id);
          if (!p) return null;
          const alive = agent.status === "alive";
          const r = radius(agent);
          const dimmed =
            selectedId !== null &&
            selectedId !== agent.id &&
            selectedId !== agent.parentId;

          return (
            <g
              key={agent.id}
              transform={`translate(${p.x} ${p.y})`}
              opacity={dimmed ? 0.3 : 1}
              onMouseEnter={() => onSelect(agent.id)}
              onMouseLeave={() => onSelect(null)}
              style={{ cursor: "pointer" }}
            >
              <circle
                r={r}
                fill={alive ? "var(--alive)" : "none"}
                stroke={alive ? "none" : "var(--dead)"}
                strokeWidth={1.4}
                fillOpacity={agent.profitUsd >= 0 ? 0.9 : 0.35}
              />
              {agent.isChampion && (
                <circle
                  r={r + 4.5}
                  fill="none"
                  stroke="var(--sulfur)"
                  strokeWidth={1.6}
                />
              )}
              <text
                x={r + 6}
                y={4}
                fontSize={11}
                fill="var(--ink-soft)"
                className="tnum"
              >
                {agent.label}
              </text>
            </g>
          );
        })}
      </svg>

      <figcaption
        style={{
          display: "flex",
          gap: "1.5rem",
          flexWrap: "wrap",
          paddingTop: "0.75rem",
          fontSize: 13,
          color: "var(--ink-soft)",
        }}
      >
        <Key shape="filled">Trading now, sized by profit</Key>
        <Key shape="hollow">Shut down</Key>
        <Key shape="ringed">Best earner</Key>
        <span>Lines join a child to the parent it mutated from.</span>
      </figcaption>
    </figure>
  );
}

function Key({
  shape,
  children,
}: {
  shape: "filled" | "hollow" | "ringed";
  children: React.ReactNode;
}) {
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}
    >
      <svg width={20} height={20} aria-hidden="true">
        <g transform="translate(10 10)">
          {shape === "filled" && (
            <circle r={6} fill="var(--alive)" fillOpacity={0.9} />
          )}
          {shape === "hollow" && (
            <circle r={6} fill="none" stroke="var(--dead)" strokeWidth={1.4} />
          )}
          {shape === "ringed" && (
            <>
              <circle r={4.5} fill="var(--alive)" fillOpacity={0.9} />
              <circle
                r={8}
                fill="none"
                stroke="var(--sulfur)"
                strokeWidth={1.6}
              />
            </>
          )}
        </g>
      </svg>
      {children}
    </span>
  );
}
