"use client";

import { useEffect, useRef, useState } from "react";
import type { CampaignView } from "@/lib/view";

/**
 * The agents selling, out loud, one after another.
 *
 * Speech synthesis is the browser's, not a service: it costs nothing, needs no key, and
 * cannot fail on stage because a network call timed out. Each agent gets a different voice,
 * pitch and rate derived from its genome, so the strategies are audibly different.
 */

type Voice = { rate: number; pitch: number; lang: string };

type Pitch = {
  agentId: string;
  label: string;
  strategy: Record<string, string>;
  creative: {
    headline: string;
    body: string;
    cta: string;
    spoken: string;
    source: "llm" | "template";
  } | null;
  voice: Voice;
};

export function PitchStage({
  campaign,
  context,
  image,
}: {
  campaign: CampaignView;
  context: string;
  image: string | null;
}) {
  const [pitches, setPitches] = useState<Pitch[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [canSpeak, setCanSpeak] = useState(true);
  const cancelled = useRef(false);

  useEffect(() => {
    setCanSpeak(
      typeof window !== "undefined" && "speechSynthesis" in window,
    );
    // Leaving the page mid-sentence would otherwise keep the voice going.
    return () => {
      cancelled.current = true;
      if (typeof window !== "undefined" && "speechSynthesis" in window)
        window.speechSynthesis.cancel();
    };
  }, []);

  async function run() {
    setLoading(true);
    setError(null);
    setNote(null);
    setPitches(null);
    try {
      const res = await fetch("/api/pitch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context, image }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "The agents could not write their pitches.");
        return;
      }
      setPitches(data.pitches);
      if (data.degraded)
        setNote(
          `Wrote these from templates — the ${data.provider ?? "model"} call failed: ${data.degraded}`,
        );
      else if (!data.usedModel)
        setNote(
          data.configHint ??
            "Wrote these from templates — no model is configured.",
        );
      await speakAll(data.pitches);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  /** One at a time, in order, so the comparison is actually listenable. */
  async function speakAll(list: Pitch[]) {
    if (!canSpeak) return;
    cancelled.current = false;
    window.speechSynthesis.cancel();

    const voices = window.speechSynthesis.getVoices();
    for (let i = 0; i < list.length; i++) {
      if (cancelled.current) break;
      const p = list[i];
      if (!p.creative?.spoken) continue;
      setSpeakingId(p.agentId);
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(p.creative!.spoken);
        u.rate = p.voice.rate;
        u.pitch = p.voice.pitch;
        u.lang = p.voice.lang;
        // Spread the agents across whatever voices this machine actually has.
        const usable = voices.filter((v) => v.lang.startsWith("en"));
        if (usable.length > 0) u.voice = usable[i % usable.length];
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
      });
    }
    setSpeakingId(null);
  }

  function stop() {
    cancelled.current = true;
    if (canSpeak) window.speechSynthesis.cancel();
    setSpeakingId(null);
  }

  function replay(p: Pitch) {
    if (!canSpeak || !p.creative?.spoken) return;
    window.speechSynthesis.cancel();
    setSpeakingId(p.agentId);
    const u = new SpeechSynthesisUtterance(p.creative.spoken);
    u.rate = p.voice.rate;
    u.pitch = p.voice.pitch;
    u.lang = p.voice.lang;
    u.onend = () => setSpeakingId(null);
    u.onerror = () => setSpeakingId(null);
    window.speechSynthesis.speak(u);
  }

  const aliveCount = campaign.agents.filter((a) => a.status === "alive").length;

  return (
    <section className="band" style={{ paddingTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1.25rem" }}>Hear them sell it</h2>
      <p
        style={{
          color: "var(--ink-soft)",
          marginTop: "0.6rem",
          maxWidth: "62ch",
        }}
      >
        Each living agent writes the pitch its own strategy implies, then says it out loud.
        Same product, {aliveCount} different ways to sell it.
      </p>

      <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem" }}>
        <button type="button" onClick={run} disabled={loading || aliveCount === 0}>
          {loading ? "Writing pitches…" : "Run the pitch-off"}
        </button>
        {speakingId && (
          <button type="button" onClick={stop}>
            Stop
          </button>
        )}
      </div>

      {!canSpeak && (
        <p style={{ color: "var(--ink-soft)", marginTop: "0.8rem" }}>
          This browser has no speech synthesis, so the pitches will be written out but not
          spoken. Chrome, Edge and Safari all support it.
        </p>
      )}
      {note && (
        <p style={{ color: "var(--ink-soft)", marginTop: "0.8rem" }}>{note}</p>
      )}
      {error && (
        <p style={{ color: "var(--loss, #b4462f)", marginTop: "0.8rem" }}>{error}</p>
      )}

      {pitches && (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            marginTop: "1.2rem",
            display: "grid",
            gap: "0.8rem",
          }}
        >
          {pitches.map((p) => {
            const speaking = speakingId === p.agentId;
            return (
              <li
                key={p.agentId}
                style={{
                  border: "1px solid var(--rule, #d9d2c5)",
                  borderLeftWidth: speaking ? "4px" : "1px",
                  borderLeftColor: speaking ? "var(--gain, #2f7d55)" : undefined,
                  background: speaking ? "var(--raise, #f4f1ea)" : "transparent",
                  padding: "0.9rem 1rem",
                  transition: "background 120ms ease",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "0.6rem",
                    flexWrap: "wrap",
                  }}
                >
                  <strong>{p.label}</strong>
                  {speaking && (
                    <span style={{ color: "var(--gain, #2f7d55)", fontSize: "0.85rem" }}>
                      speaking now
                    </span>
                  )}
                  <span style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
                    {p.strategy.tone} · {String(p.strategy.cta).replace(/_/g, " ")} ·{" "}
                    {String(p.strategy.platform).replace(/_/g, " ")}
                  </span>
                  {canSpeak && (
                    <button
                      type="button"
                      onClick={() => replay(p)}
                      style={{ marginLeft: "auto", fontSize: "0.8rem" }}
                    >
                      Replay
                    </button>
                  )}
                </div>
                {p.creative && (
                  <p style={{ margin: "0.5rem 0 0" }}>{p.creative.spoken}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
