import { useEffect, useRef, useState } from "react";

export function useDictation(
  value: string,
  onChange: (value: string) => void,
  onActiveChange: (active: boolean) => void,
) {
  const recognition = useRef<SpeechRecognition | null>(null);
  const [phase, setPhase] = useState<"idle" | "starting" | "listening" | "stopping">("idle");
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      const current = recognition.current;
      recognition.current = null;
      if (current) {
        current.onresult = null;
        current.onstart = null;
        current.onerror = null;
        current.onend = null;
        current.abort();
        onActiveChange(false);
      }
    },
    [onActiveChange],
  );

  function toggle() {
    if (recognition.current) {
      setPhase("stopping");
      if (phase === "starting") recognition.current.abort();
      else recognition.current.stop();
      return;
    }
    setError("");
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setError("This browser doesn't support dictation. Try your keyboard's microphone.");
      return;
    }
    if (!window.isSecureContext) {
      setError("Open Duckpond using its HTTPS address to use the microphone.");
      return;
    }
    const current = new Recognition();
    const prefix = value + (value && !/\s$/.test(value) ? " " : "");
    recognition.current = current;
    current.lang = navigator.language || "en-US";
    current.continuous = true;
    current.interimResults = true;
    current.onstart = () => setPhase("listening");
    current.onresult = (event) => {
      // Results include the whole session. Rebuild it so revised interim words don't duplicate.
      const spoken = Array.from(event.results, (result) => result[0].transcript.trim()).join(" ");
      const draft = prefix + spoken;
      onChange(draft.slice(0, 20000));
      if (draft.length > 20000) {
        setError("The draft reached its 20,000-character limit. Dictation stopped.");
        setPhase("stopping");
        current.stop();
      }
    };
    current.onerror = (event) => {
      if (event.error === "aborted") return;
      setError(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Microphone access was denied. Allow it in your browser's site settings, then try again."
          : event.error === "audio-capture"
            ? "No microphone is available. Check your microphone connection and browser settings."
            : event.error === "no-speech"
              ? "No speech detected. Tap Dictate to try again."
              : event.error === "network"
                ? "The browser's speech service couldn't connect. Your draft is still here; tap Dictate to retry."
                : "Browser dictation stopped. Your draft is still here; tap Dictate to retry.",
      );
    };
    current.onend = () => {
      recognition.current = null;
      setPhase("idle");
      onActiveChange(false);
    };
    setPhase("starting");
    onActiveChange(true);
    try {
      current.start();
    } catch {
      recognition.current = null;
      setPhase("idle");
      onActiveChange(false);
      setError("Couldn't start browser dictation. Check microphone permissions and try again.");
    }
  }

  return { phase, error, toggle, active: phase !== "idle" };
}
