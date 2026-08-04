"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createWorker } from "tesseract.js";

type LorcastCard = {
  name: string;
  version?: string | null;
  collector_number: string;
  rarity: string;
  ink?: string | null;
  type?: string[];
  set: { code: string; name: string };
  image_uris?: { digital?: { small?: string } };
};

type PendingCard = {
  name: string;
  set: string;
  number: string;
};

export default function ScanPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [matchedCard, setMatchedCard] = useState<LorcastCard | null>(null);
  const [ocrText, setOcrText] = useState("");
  const [status, setStatus] = useState("Start the camera or choose a card photo.");
  const [progress, setProgress] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function startCamera() {
    try {
      setError("");
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraOn(true);
        setStatus("Camera ready. Hold the whole card steady inside the guide.");
      }
    } catch {
      setError("Camera could not be started. Allow camera access or choose a photo below.");
    }
  }

  async function captureCard() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    await scanSource(canvas);
  }

  async function choosePhoto(file?: File) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = document.createElement("img");
    image.onload = async () => {
      await scanSource(image);
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setError("That photo could not be opened.");
    };
    image.src = url;
  }

  async function scanSource(source: HTMLCanvasElement | HTMLImageElement) {
    setScanning(true);
    setMatchedCard(null);
    setOcrText("");
    setError("");
    setProgress(0);
    setStatus("Preparing the card scanner…");

    const prepared = prepareImage(source);
    setCapturedImage(prepared.toDataURL("image/jpeg", 0.9));

    try {
      const worker = await createWorker("eng", 1, {
        logger: (message) => {
          if (message.status === "recognizing text") {
            const nextProgress = Math.round((message.progress || 0) * 100);
            setProgress(nextProgress);
            setStatus(`Reading card… ${nextProgress}%`);
          }
        },
      });
      const result = await worker.recognize(prepared);
      await worker.terminate();

      const text = result.data.text.trim();
      setOcrText(text);
      setStatus("Text read. Looking for the exact Lorcana card…");

      const card = await identifyCard(text);
      if (card) {
        setMatchedCard(card);
        setStatus("Match found. Confirm the card below.");
      } else {
        setError("No exact match found. Try a closer, sharper photo in even light.");
        setStatus("Scan finished without a match.");
      }
    } catch {
      setError("The scan failed. Check your connection and try a sharper photo.");
      setStatus("Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  function prepareImage(source: HTMLCanvasElement | HTMLImageElement) {
    const sourceWidth = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
    const sourceHeight = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
    const scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return canvas;

    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < image.data.length; index += 4) {
      const grey = 0.299 * image.data[index] + 0.587 * image.data[index + 1] + 0.114 * image.data[index + 2];
      const boosted = grey < 145 ? Math.max(0, grey * 0.72) : Math.min(255, grey * 1.12);
      image.data[index] = boosted;
      image.data[index + 1] = boosted;
      image.data[index + 2] = boosted;
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  async function identifyCard(text: string): Promise<LorcastCard | null> {
    const normalized = text.replace(/[|Il]/g, "1");
    const numberMatch = normalized.match(/(\d{1,3}[A-Za-z]?)\s*\/\s*(\d{2,3})/);
    const setMatch =
      normalized.match(/(?:EN|FR|DE|IT)\s*[-:]?\s*(\d{1,2})\b/i) ||
      normalized.match(/\b(\d{1,2})\s*(?:EN|FR|DE|IT)\b/i);

    if (numberMatch && setMatch) {
      const response = await fetch(`/api/cards?set=${encodeURIComponent(setMatch[1])}&number=${encodeURIComponent(numberMatch[1])}`);
      if (response.ok) return response.json();
    }

    const candidates = text
      .split(/\n+/)
      .map((line) => line.replace(/[^A-Za-z0-9 '\-&]/g, " ").replace(/\s+/g, " ").trim())
      .filter((line) => /[A-Za-z]{3}/.test(line) && line.length < 55)
      .slice(0, 5);

    for (const query of candidates) {
      const response = await fetch(`/api/cards?q=${encodeURIComponent(query)}`);
      if (!response.ok) continue;
      const cards: LorcastCard[] = await response.json();
      const exactNumber = numberMatch && cards.find(
        (card) => card.collector_number.toLowerCase() === numberMatch[1].toLowerCase(),
      );
      if (exactNumber) return exactNumber;
      if (cards.length === 1) return cards[0];
    }
    return null;
  }

  function useMatchedCard() {
    if (!matchedCard) return;
    const pendingCard: PendingCard = {
      name: [matchedCard.name, matchedCard.version].filter(Boolean).join(" - "),
      set: matchedCard.set.name,
      number: matchedCard.collector_number,
    };
    localStorage.setItem("lorcanaPendingCard", JSON.stringify(pendingCard));
    router.push("/");
  }

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white sm:p-6">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-lg text-yellow-400">← Back to Vault</Link>
        <h1 className="mt-6 text-4xl font-bold sm:text-5xl">📷 Scan Cards</h1>
        <p className="mt-3 text-slate-400">Scan a card, confirm the match, then add it to your vault.</p>

        <section className="mt-6 rounded-2xl bg-slate-900 p-4 sm:p-5">
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} playsInline muted autoPlay className="min-h-72 w-full object-cover" />
            <div className="pointer-events-none absolute left-1/2 top-1/2 aspect-[63/88] w-[64%] max-w-64 -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-yellow-400 shadow-[0_0_0_999px_rgba(0,0,0,0.18)]" />
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button onClick={startCamera} disabled={scanning} className="rounded-xl bg-slate-700 px-6 py-4 font-bold disabled:opacity-50">
              {cameraOn ? "Restart Camera" : "Start Camera"}
            </button>
            <button onClick={captureCard} disabled={!cameraOn || scanning} className="rounded-xl bg-yellow-400 px-6 py-4 font-bold text-black disabled:opacity-50">
              {scanning ? "Scanning…" : "Scan Card"}
            </button>
          </div>

          <label className="mt-3 block cursor-pointer rounded-xl bg-slate-800 px-6 py-4 text-center font-bold">
            Or choose a card photo
            <input type="file" accept="image/*" capture="environment" className="hidden" disabled={scanning} onChange={(event) => choosePhoto(event.target.files?.[0])} />
          </label>

          <p className="mt-4 text-sm text-slate-300" role="status" aria-live="polite">{status}</p>
          {scanning && <progress className="mt-2 h-2 w-full accent-yellow-400" max="100" value={progress} />}
          {error && <p className="mt-3 font-semibold text-red-400">{error}</p>}

          {matchedCard && (
            <article className="mt-5 grid grid-cols-[88px_1fr] gap-4 rounded-2xl border border-yellow-400 bg-slate-950 p-3">
              {/* Dynamic Lorcast card art is intentionally loaded directly. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={matchedCard.image_uris?.digital?.small || ""} alt={`${matchedCard.name} Lorcana card`} className="w-[88px] rounded-lg" />
              <div className="self-center">
                <h2 className="text-xl font-bold">{[matchedCard.name, matchedCard.version].filter(Boolean).join(" — ")}</h2>
                <p className="mt-1 text-sm text-slate-400">{matchedCard.set.name} · #{matchedCard.collector_number} · {matchedCard.rarity.replace("_", " ")}</p>
                <button onClick={useMatchedCard} className="mt-4 rounded-xl bg-green-400 px-5 py-3 font-bold text-slate-950">Use This Card</button>
              </div>
            </article>
          )}

          {capturedImage && !matchedCard && (
            <details className="mt-5 text-slate-300">
              <summary className="cursor-pointer font-semibold">Show captured image and recognised text</summary>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={capturedImage} alt="Captured Lorcana card" className="mt-3 w-full rounded-xl border border-slate-700" />
              <textarea value={ocrText} onChange={(event) => setOcrText(event.target.value)} className="mt-3 min-h-32 w-full rounded-xl border border-slate-700 bg-slate-800 p-3" />
            </details>
          )}

          <canvas ref={canvasRef} className="hidden" />
        </section>
      </div>
    </main>
  );
}
