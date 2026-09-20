import { describe, expect, it } from "vitest";
import { renderCreativeSvg, visualFor } from "./visual";
import { randomGenome } from "../genome";
import { mulberry32 } from "../rng";

/**
 * The claim this feature makes to a juror is "different strategies make different ads".
 * If two genomes render the same artwork, that claim is false on screen.
 */

const g = randomGenome(mulberry32(3));

describe("artwork is derived from the genome", () => {
  it("gives different tones different palettes and moods", () => {
    const urgent = visualFor({ ...g, tone: "urgent" });
    const playful = visualFor({ ...g, tone: "humorous" });
    expect(urgent.bg).not.toBe(playful.bg);
    expect(urgent.accent).not.toBe(playful.accent);
    expect(urgent.mood).not.toBe(playful.mood);
  });

  it("gives different content types different layouts", () => {
    expect(visualFor({ ...g, contentType: "short_video" }).layout).toBe("hero");
    expect(visualFor({ ...g, contentType: "long_form" }).layout).toBe("stack");
    expect(visualFor({ ...g, contentType: "static_image" }).layout).toBe("poster");
  });

  it("falls back rather than throwing on an unknown gene value", () => {
    const odd = visualFor({ ...g, tone: "not-a-tone" as never });
    expect(odd.bg).toBeTruthy();
    expect(odd.mood).toBeTruthy();
  });

  it("renders a usable inline image, with no network needed", () => {
    const svg = renderCreativeSvg(visualFor(g), "Buy it now", "Aurora Mask");
    expect(svg.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    const decoded = decodeURIComponent(svg.split(",")[1]);
    expect(decoded).toContain("<svg");
    expect(decoded).toContain("Aurora Mask");
  });

  it("escapes copy so a quote in a headline cannot break the markup", () => {
    const svg = renderCreativeSvg(visualFor(g), 'He said "buy" & <left>', "P");
    const decoded = decodeURIComponent(svg.split(",")[1]);
    expect(decoded).toContain("&amp;");
    expect(decoded).toContain("&quot;");
    expect(decoded).not.toContain("<left>");
  });

  it("two agents advertising the same product get different artwork", () => {
    const a = renderCreativeSvg(visualFor({ ...g, tone: "urgent" }), "Now", "P");
    const b = renderCreativeSvg(visualFor({ ...g, tone: "humorous" }), "Now", "P");
    expect(a).not.toBe(b);
  });
});
