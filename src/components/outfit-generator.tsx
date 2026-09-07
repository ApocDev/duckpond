import { useEffect, useState } from "react";
import type { Duck } from "../lib/room";
import type { OutfitJob } from "../lib/outfits";
import { generateOutfit, loadOutfits } from "../server/outfits.functions";
import { DuckAvatar } from "./duck-avatar";

export function OutfitGenerator({
  roomId,
  duck,
  onUse,
}: {
  roomId: string;
  duck: Duck;
  onUse: (avatar: string) => void;
}) {
  const [jobs, setJobs] = useState<OutfitJob[]>([]);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const active = jobs.some((job) => job.status === "running");
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      clearTimeout(timer);
      if (document.hidden) return;
      try {
        const result = await loadOutfits({ data: roomId });
        if (disposed) return;
        const own = result.filter((job) => job.duckId === duck.id);
        setJobs(own);
        setError("");
        if (own.some((job) => job.status === "running"))
          timer = setTimeout(() => void refresh(), 5000);
      } catch (cause) {
        if (disposed) return;
        setError(cause instanceof Error ? cause.message : "Couldn't load outfits.");
        timer = setTimeout(() => void refresh(), 10000);
      }
    }
    void refresh();
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [roomId, duck.id, active]);
  async function generate() {
    if (starting || active) return;
    setStarting(true);
    setError("");
    try {
      const job = await generateOutfit({ data: { roomId, duck, description } });
      setJobs((previous) => [...previous.filter((item) => item.id !== job.id), job]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't start outfit generation.");
    } finally {
      setStarting(false);
    }
  }
  return (
    <div className="outfit-generator">
      <label>
        Describe an outfit
        <input
          aria-label={`${duck.name} outfit description`}
          maxLength={1000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Leave blank to match this duck's perspective"
        />
      </label>
      <button
        type="button"
        className="suggest-duck-button"
        disabled={starting || active}
        onClick={() => void generate()}
      >
        {starting ? "Starting..." : active ? "Generating outfit..." : "Generate outfit"}
      </button>
      <p className="mention-handle">
        Uses Codex image generation. You can close settings while it runs.
      </p>
      {error && <p role="alert">{error}</p>}
      {jobs
        .slice(-1)
        .filter((job) => job.status === "error")
        .map((job) => (
          <p key={job.id} role="alert">
            {job.error}
          </p>
        ))}
      <div className="outfit-previews">
        {jobs
          .filter((job) => job.status === "complete")
          .map((job) => {
            const avatar = `generated-${job.id}`;
            return (
              <div key={job.id} className="outfit-preview">
                <DuckAvatar avatar={avatar} />
                <span>{job.description || "Based on this duck's perspective"}</span>
                <button
                  type="button"
                  className="suggest-duck-button"
                  aria-pressed={duck.avatar === avatar}
                  onClick={() => onUse(avatar)}
                >
                  {duck.avatar === avatar ? "Selected" : "Use outfit"}
                </button>
              </div>
            );
          })}
      </div>
      {jobs.some((job) => job.status === "complete") && (
        <p className="mention-handle">Choose an outfit, then Save room to keep it.</p>
      )}
    </div>
  );
}
