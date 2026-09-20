import type { Genome } from "../genome";

/**
 * The look of an agent's ad, derived from its genome.
 *
 * Claude has no image endpoint, and bolting on a paid image API would add a key, seconds of
 * latency per agent and a live failure point on stage. So the "creative image" is rendered
 * here instead: a deterministic palette and layout from the strategy, drawn as SVG.
 *
 * The point of Step 4 is that two agents advertising the same product produce *visibly
 * different* creatives. A palette driven by tone and a layout driven by content type does
 * that honestly, costs nothing, and cannot fail mid-demo. It is not photoreal, and the UI
 * does not pretend otherwise.
 */

export type VisualConcept = {
  /** Background wash. */
  bg: string;
  /** Headline and body ink. */
  ink: string;
  /** The one loud colour: CTA chip, rules, accents. */
  accent: string;
  /** How the card is composed — follows the genome's content type. */
  layout: "hero" | "split" | "stack" | "poster";
  /** A word a juror can read off the card to see the strategy. */
  mood: string;
};

/**
 * Tone picks the palette. These are chosen to read as different *attitudes* at a glance —
 * an urgent ad should not look like an educational one from across a room.
 */
const TONE_PALETTE: Record<
  string,
  { bg: string; ink: string; accent: string; mood: string }
> = {
  urgent: { bg: "#2b1410", ink: "#fdf3ec", accent: "#e2561f", mood: "urgent" },
  humorous: { bg: "#fff4d6", ink: "#2a2410", accent: "#e0a21a", mood: "playful" },
  educational: { bg: "#eef3f7", ink: "#16232e", accent: "#2d6ea8", mood: "explanatory" },
  aspirational: { bg: "#151327", ink: "#f2eefc", accent: "#8b6ff0", mood: "aspirational" },
  empathetic: { bg: "#f6efe9", ink: "#2e2520", accent: "#a8705a", mood: "warm" },
};

/** Content type picks the composition, the way a real brief would. */
const LAYOUT_BY_CONTENT: Record<string, VisualConcept["layout"]> = {
  short_video: "hero",
  carousel: "split",
  static_image: "poster",
  long_form: "stack",
  meme: "hero",
  testimonial: "stack",
};

export function visualFor(genome: Genome): VisualConcept {
  const palette = TONE_PALETTE[genome.tone] ?? TONE_PALETTE.educational;
  return {
    ...palette,
    layout: LAYOUT_BY_CONTENT[genome.contentType] ?? "poster",
  };
}

/**
 * Render the concept as a self-contained SVG data URL.
 *
 * Inline and data-encoded so it needs no network, no storage and no build step — it can be
 * dropped straight into an `<img src>` and survives a snapshot reload. When the user
 * uploaded a product photo the card shows that instead; this is the fallback that still
 * makes each agent's strategy visible when there is no photo.
 */
export function renderCreativeSvg(
  concept: VisualConcept,
  headline: string,
  productName: string,
): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // Wrap the headline by hand: SVG has no text flow, and a long line would run off the card.
  const words = headline.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > 26) {
      if (line) lines.push(line.trim());
      line = w;
    } else {
      line = `${line} ${w}`;
    }
    if (lines.length >= 3) break;
  }
  if (line && lines.length < 3) lines.push(line.trim());

  const W = 480;
  const H = 300;

  // Each layout puts the accent somewhere different, so the composition reads as a choice.
  const decoration =
    concept.layout === "hero"
      ? `<circle cx="${W - 70}" cy="70" r="90" fill="${concept.accent}" opacity="0.22"/>`
      : concept.layout === "split"
        ? `<rect x="0" y="0" width="${W * 0.38}" height="${H}" fill="${concept.accent}" opacity="0.16"/>`
        : concept.layout === "stack"
          ? `<rect x="40" y="${H - 84}" width="${W - 80}" height="4" fill="${concept.accent}"/>`
          : `<rect x="0" y="0" width="${W}" height="10" fill="${concept.accent}"/>`;

  const textY = concept.layout === "stack" ? 92 : 120;
  const tspans = lines
    .map(
      (l, i) =>
        `<tspan x="40" dy="${i === 0 ? 0 : 34}">${esc(l)}</tspan>`,
    )
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
<rect width="${W}" height="${H}" fill="${concept.bg}"/>
${decoration}
<text x="40" y="${textY}" fill="${concept.ink}" font-family="Georgia, serif" font-size="29" font-weight="600">${tspans}</text>
<text x="40" y="${H - 44}" fill="${concept.ink}" opacity="0.72" font-family="Georgia, serif" font-size="15">${esc(productName)}</text>
<text x="40" y="${H - 22}" fill="${concept.accent}" font-family="Georgia, serif" font-size="13" letter-spacing="1.5">${esc(concept.mood.toUpperCase())}</text>
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
