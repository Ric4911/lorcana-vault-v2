"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createWorker, PSM, type Worker as TesseractWorker } from "tesseract.js";

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

type StoredCard = PendingCard & {
  id: string;
  quantity: number;
  foil: number;
  condition: string;
  binder: string;
  box: string;
  value: number;
};

type ScanMode = "single" | "binder";

type BinderMatch = {
  slot: number;
  card: LorcastCard;
  foil: boolean;
};

export default function ScanPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<TesseractWorker | null>(null);
  const workerPromiseRef = useRef<Promise<TesseractWorker> | null>(null);
  const savingRef = useRef(false);
  const ocrContextRef = useRef({ index: 0, total: 1, label: "Reading card" });

  const [scanMode, setScanMode] = useState<ScanMode>("single");
  const [cameraOn, setCameraOn] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [matchedCard, setMatchedCard] = useState<LorcastCard | null>(null);
  const [binderMatches, setBinderMatches] = useState<BinderMatch[]>([]);
  const [missedSlots, setMissedSlots] = useState<number[]>([]);
  const [ocrText, setOcrText] = useState("");
  const [status, setStatus] = useState("Start the camera or choose a card photo.");
  const [progress, setProgress] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sessionAdded, setSessionAdded] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (workerRef.current) void workerRef.current.terminate();
    };
  }, []);

  async function getOcrWorker() {
    if (workerRef.current) return workerRef.current;
    if (workerPromiseRef.current) return workerPromiseRef.current;

    workerPromiseRef.current = createWorker("eng", 1, {
      logger: (message) => {
        if (message.status === "recognizing text") {
          const localProgress = message.progress || 0;
          const context = ocrContextRef.current;
          const nextProgress = Math.round(((context.index + localProgress) / context.total) * 100);
          setProgress(nextProgress);
          setStatus(`${context.label}… ${Math.round(localProgress * 100)}%`);
        }
      },
    }).then((worker) => {
      workerRef.current = worker;
      workerPromiseRef.current = null;
      return worker;
    }).catch((workerError) => {
      workerPromiseRef.current = null;
      throw workerError;
    });

    return workerPromiseRef.current;
  }

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
        setStatus(scanMode === "binder"
          ? "Camera ready. Line up the entire 3×3 page inside the guide."
          : "Camera ready. Hold the whole card steady inside the guide.");
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
    if (scanMode === "binder") await scanBinderSource(canvas);
    else await scanSource(canvas);
  }

  async function choosePhoto(file?: File) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = document.createElement("img");
    image.onload = async () => {
      if (scanMode === "binder") await scanBinderSource(image);
      else await scanSource(image);
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
    setBinderMatches([]);
    setMissedSlots([]);
    setOcrText("");
    setError("");
    setProgress(0);
    setStatus("Preparing the card scanner…");

    const cardCrop = cropToCardGuide(source);
    const prepared = prepareImage(cardCrop);
    setCapturedImage(prepared.toDataURL("image/jpeg", 0.9));

    try {
      ocrContextRef.current = { index: 0, total: 1, label: "Reading card" };
      const { card, text } = await recognizePreparedCard(prepared, true, (message) => setStatus(message));
      setOcrText(text);

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

  async function recognizePreparedCard(
    prepared: HTMLCanvasElement,
    includeFullScan: boolean,
    onStage?: (message: string) => void,
  ) {
    const worker = await getOcrWorker();
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const titleResult = await worker.recognize(cropRegion(prepared, 0.03, 0.46, 0.94, 0.25));
    let text = titleResult.data.text.trim();
    onStage?.("Card title read. Looking for an exact match…");

    let card = await identifyCard(text);
    if (!card) {
      onStage?.("Checking the collector number and promo code…");
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      const collectorResult = await worker.recognize(cropRegion(prepared, 0.01, 0.82, 0.98, 0.18));
      text = [text, collectorResult.data.text.trim()].filter(Boolean).join("\n");
      card = await identifyCard(text);
    }
    if (!card && includeFullScan) {
      onStage?.("Checking the remaining card text…");
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const fullResult = await worker.recognize(prepared);
      text = [text, fullResult.data.text.trim()].filter(Boolean).join("\n");
      card = await identifyCard(text);
    }

    return { card, text };
  }

  async function scanBinderSource(source: HTMLCanvasElement | HTMLImageElement) {
    setScanning(true);
    setMatchedCard(null);
    setBinderMatches([]);
    setMissedSlots([]);
    setOcrText("");
    setError("");
    setProgress(0);
    setStatus("Preparing the 3×3 binder page…");

    const pageCrop = cropToBinderGuide(source);
    setCapturedImage(pageCrop.toDataURL("image/jpeg", 0.9));
    const slots = splitBinderPage(pageCrop);
    const matches: BinderMatch[] = [];
    const misses: number[] = [];

    try {
      for (let index = 0; index < slots.length; index += 1) {
        const slot = index + 1;
        ocrContextRef.current = { index, total: slots.length, label: `Reading pocket ${slot} of 9` };
        setStatus(`Reading pocket ${slot} of 9…`);

        try {
          const prepared = prepareImage(slots[index]);
          const { card } = await recognizePreparedCard(prepared, false, (message) => {
            setStatus(`Pocket ${slot} of 9: ${message}`);
          });
          if (card) matches.push({ slot, card, foil: false });
          else misses.push(slot);
        } catch {
          misses.push(slot);
        }

        setBinderMatches([...matches]);
        setMissedSlots([...misses]);
        setProgress(Math.round((slot / slots.length) * 100));
      }

      if (matches.length) {
        setStatus(`Found ${matches.length} card${matches.length === 1 ? "" : "s"}. Check them, mark any foils, then add the page.`);
        navigator.vibrate?.(50);
      } else {
        setError("No cards were matched. Retake the photo with the page flat, square and evenly lit.");
        setStatus("Binder scan finished without a match.");
      }
    } finally {
      setScanning(false);
    }
  }

  function cropToCardGuide(source: HTMLCanvasElement | HTMLImageElement) {
    const sourceWidth = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
    const sourceHeight = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
    let cropWidth = sourceWidth * 0.68;
    let cropHeight = cropWidth * (88 / 63);

    if (cropHeight > sourceHeight * 0.94) {
      cropHeight = sourceHeight * 0.94;
      cropWidth = cropHeight * (63 / 88);
    }

    const cropX = (sourceWidth - cropWidth) / 2;
    const cropY = (sourceHeight - cropHeight) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(cropWidth));
    canvas.height = Math.max(1, Math.round(cropHeight));
    canvas.getContext("2d")?.drawImage(
      source,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return canvas;
  }

  function cropToBinderGuide(source: HTMLCanvasElement | HTMLImageElement) {
    const sourceWidth = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
    const sourceHeight = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
    let cropWidth = sourceWidth * 0.72;
    let cropHeight = cropWidth * (264 / 189);

    if (cropHeight > sourceHeight * 0.94) {
      cropHeight = sourceHeight * 0.94;
      cropWidth = cropHeight * (189 / 264);
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(cropWidth));
    canvas.height = Math.max(1, Math.round(cropHeight));
    canvas.getContext("2d")?.drawImage(
      source,
      (sourceWidth - cropWidth) / 2,
      (sourceHeight - cropHeight) / 2,
      cropWidth,
      cropHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return canvas;
  }

  function splitBinderPage(page: HTMLCanvasElement) {
    return Array.from({ length: 9 }, (_, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const cellWidth = page.width / 3;
      const cellHeight = page.height / 3;
      let cardWidth = cellWidth * 0.92;
      let cardHeight = cardWidth * (88 / 63);

      if (cardHeight > cellHeight * 0.94) {
        cardHeight = cellHeight * 0.94;
        cardWidth = cardHeight * (63 / 88);
      }

      const sourceX = column * cellWidth + (cellWidth - cardWidth) / 2;
      const sourceY = row * cellHeight + (cellHeight - cardHeight) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(cardWidth));
      canvas.height = Math.max(1, Math.round(cardHeight));
      canvas.getContext("2d")?.drawImage(
        page,
        sourceX,
        sourceY,
        cardWidth,
        cardHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      return canvas;
    });
  }

  function prepareImage(source: HTMLCanvasElement | HTMLImageElement) {
    const sourceWidth = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
    const sourceHeight = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
    const scale = Math.min(2.5, 1800 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return canvas;

    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < image.data.length; index += 4) {
      const grey = 0.299 * image.data[index] + 0.587 * image.data[index + 1] + 0.114 * image.data[index + 2];
      const boosted = Math.max(0, Math.min(255, (grey - 128) * 1.25 + 128));
      image.data[index] = boosted;
      image.data[index + 1] = boosted;
      image.data[index + 2] = boosted;
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  function cropRegion(source: HTMLCanvasElement, x: number, y: number, width: number, height: number) {
    const sourceX = Math.round(source.width * x);
    const sourceY = Math.round(source.height * y);
    const sourceRegionWidth = Math.round(source.width * width);
    const sourceRegionHeight = Math.round(source.height * height);
    const canvas = document.createElement("canvas");
    const scale = Math.max(1, 1400 / sourceRegionWidth);
    canvas.width = Math.round(sourceRegionWidth * scale);
    canvas.height = Math.round(sourceRegionHeight * scale);
    canvas.getContext("2d")?.drawImage(
      source,
      sourceX,
      sourceY,
      sourceRegionWidth,
      sourceRegionHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return canvas;
  }

  async function identifyCard(text: string): Promise<LorcastCard | null> {
    const normalized = text.replace(/[|Il]/g, "1");
    const numberMatch = normalized.match(/(\d{1,3}[A-Za-z]{0,3})\s*\/\s*([A-Za-z]{1,3}\s*\d{0,2}|\d{2,3})/i);
    const denominator = numberMatch?.[2].replace(/\s+/g, "") || "";
    const printedPromoCode = /[A-Za-z]/.test(denominator) ? normalizeSetCode(denominator) : null;
    const loosePromoCode = normalized.match(/\b(P\s*D?\s*\d{1,2}|C\s*P)\b/i)?.[1];
    const promoSetCode = printedPromoCode || (loosePromoCode ? normalizeSetCode(loosePromoCode) : null);
    const setMatch =
      normalized.match(/(?:EN|FR|DE|IT)\s*[-:]?\s*(\d{1,2})\b/i) ||
      normalized.match(/\b(\d{1,2})\s*(?:EN|FR|DE|IT)\b/i);
    const targetSetCode = promoSetCode || setMatch?.[1] || null;

    if (numberMatch && targetSetCode) {
      const response = await fetch(`/api/cards?set=${encodeURIComponent(targetSetCode)}&number=${encodeURIComponent(numberMatch[1])}`);
      if (response.ok) return response.json();
    }

    const lines = text
      .split(/\n+/)
      .map((line) => line.replace(/[^A-Za-z0-9 '\-&]/g, " ").replace(/\s+/g, " ").trim())
      .filter((line) => /[A-Za-z]{3}/.test(line) && line.length < 55)
      .slice(0, 6);
    const candidates = [lines.slice(0, 2).join(" "), ...lines].filter(Boolean);

    for (const query of candidates) {
      const response = await fetch(`/api/cards?q=${encodeURIComponent(query)}`);
      if (!response.ok) continue;
      const cards: LorcastCard[] = await response.json();
      const exactNumber = numberMatch && cards.find(
        (card) =>
          card.collector_number.toLowerCase() === numberMatch[1].toLowerCase() &&
          (!targetSetCode || card.set.code.toLowerCase() === targetSetCode.toLowerCase()),
      );
      if (exactNumber) return exactNumber;
      if (promoSetCode) {
        const promoPrints = cards.filter(
          (card) => card.set.code.toLowerCase() === promoSetCode.toLowerCase(),
        );
        if (promoPrints.length === 1) return promoPrints[0];
      }
      if (cards.length === 1) return cards[0];
    }
    return null;
  }

  function normalizeSetCode(code: string) {
    const compact = code.replace(/\s+/g, "").toUpperCase();
    return compact === "CP" ? "cp" : compact;
  }

  function changeScanMode(mode: ScanMode) {
    setScanMode(mode);
    setMatchedCard(null);
    setBinderMatches([]);
    setMissedSlots([]);
    setCapturedImage(null);
    setOcrText("");
    setError("");
    setProgress(0);
    setStatus(mode === "binder"
      ? "Fit one complete 3×3 binder page inside the guide. Empty pockets are fine."
      : "Start the camera or choose a card photo.");
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

  function addRapidCard(isFoil: boolean) {
    if (!matchedCard || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");

    try {
      const name = [matchedCard.name, matchedCard.version].filter(Boolean).join(" - ");
      const saved = localStorage.getItem("lorcanaCards");
      const cards: StoredCard[] = saved ? JSON.parse(saved) : [];
      addCardToCollection(cards, matchedCard, isFoil);

      localStorage.setItem("lorcanaCards", JSON.stringify(cards));
      setSessionAdded((count) => count + 1);
      setMatchedCard(null);
      setCapturedImage(null);
      setOcrText("");
      setProgress(0);
      setStatus(`${isFoil ? "Foil" : "Normal"} ${name} saved. Position the next card and tap Scan Card.`);
      navigator.vibrate?.(50);
    } catch {
      setError("The card could not be saved. Please use Review details instead.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function addCardToCollection(cards: StoredCard[], card: LorcastCard, isFoil: boolean) {
    const name = [card.name, card.version].filter(Boolean).join(" - ");
    const set = card.set.name;
    const number = card.collector_number;
    const existing = cards.find(
      (savedCard) => savedCard.name === name && savedCard.set === set && savedCard.number === number,
    );

    if (existing) {
      existing.quantity = Number(existing.quantity || 0) + 1;
      if (isFoil) existing.foil = Number(existing.foil || 0) + 1;
      return;
    }

    cards.unshift({
      id: crypto.randomUUID(),
      name,
      set,
      number,
      quantity: 1,
      foil: isFoil ? 1 : 0,
      condition: "Near Mint",
      binder: "",
      box: "",
      value: 0,
    });
  }

  function setBinderFoil(slot: number, foil: boolean) {
    setBinderMatches((matches) => matches.map(
      (match) => match.slot === slot ? { ...match, foil } : match,
    ));
  }

  function removeBinderMatch(slot: number) {
    setBinderMatches((matches) => matches.filter((match) => match.slot !== slot));
    setMissedSlots((slots) => [...slots, slot].sort((left, right) => left - right));
  }

  function addBinderPage() {
    if (!binderMatches.length || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");

    try {
      const saved = localStorage.getItem("lorcanaCards");
      const cards: StoredCard[] = saved ? JSON.parse(saved) : [];
      binderMatches.forEach((match) => addCardToCollection(cards, match.card, match.foil));
      localStorage.setItem("lorcanaCards", JSON.stringify(cards));
      const added = binderMatches.length;
      setSessionAdded((count) => count + added);
      setBinderMatches([]);
      setMissedSlots([]);
      setCapturedImage(null);
      setProgress(0);
      setStatus(`${added} card${added === 1 ? "" : "s"} saved. Line up the next binder page when ready.`);
      navigator.vibrate?.(50);
    } catch {
      setError("The binder page could not be saved. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function discardBinderResults() {
    setBinderMatches([]);
    setMissedSlots([]);
    setCapturedImage(null);
    setProgress(0);
    setError("");
    setStatus("Results cleared. Line up the binder page and scan again.");
  }

  const hasUnconfirmedResults = scanMode === "single" ? Boolean(matchedCard) : binderMatches.length > 0;

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white sm:p-6">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-lg text-yellow-400">← Back to Vault</Link>
        <div className="mt-6 flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-green-400">Rapid Scan</p>
            <h1 className="text-4xl font-bold sm:text-5xl">📷 Scan Cards</h1>
          </div>
          <div className="rounded-xl bg-slate-900 px-4 py-3 text-center">
            <strong className="block text-2xl text-yellow-400">{sessionAdded}</strong>
            <span className="text-xs text-slate-400">Added now</span>
          </div>
        </div>
        <p className="mt-3 text-slate-400">Scan, confirm Normal or Foil, then move straight to the next card.</p>

        <section className="mt-6 rounded-2xl bg-slate-900 p-4 sm:p-5">
          <div className="mb-5 grid grid-cols-2 rounded-xl bg-slate-950 p-1" aria-label="Scanner mode">
            <button
              type="button"
              onClick={() => changeScanMode("single")}
              disabled={scanning || saving}
              aria-pressed={scanMode === "single"}
              className={`rounded-lg px-3 py-3 font-bold disabled:opacity-50 ${scanMode === "single" ? "bg-yellow-400 text-slate-950" : "text-slate-300"}`}
            >
              Single Card
            </button>
            <button
              type="button"
              onClick={() => changeScanMode("binder")}
              disabled={scanning || saving}
              aria-pressed={scanMode === "binder"}
              className={`rounded-lg px-3 py-3 font-bold disabled:opacity-50 ${scanMode === "binder" ? "bg-yellow-400 text-slate-950" : "text-slate-300"}`}
            >
              3×3 Binder Page
            </button>
          </div>

          {scanMode === "binder" && (
            <p className="mb-4 rounded-xl bg-slate-800 p-3 text-sm text-slate-300">
              Photograph one complete 9-pocket page straight-on. Keep cards upright, avoid sleeve glare, and leave empty pockets empty.
            </p>
          )}

          <div className="relative overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} playsInline muted autoPlay className="min-h-72 w-full object-cover" />
            {scanMode === "single" ? (
              <div className="pointer-events-none absolute left-1/2 top-1/2 aspect-[63/88] h-[88%] max-h-[520px] -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-yellow-400 shadow-[0_0_0_999px_rgba(0,0,0,0.18)]" />
            ) : (
              <div className="pointer-events-none absolute left-1/2 top-1/2 grid aspect-[189/264] h-[88%] max-h-[520px] -translate-x-1/2 -translate-y-1/2 grid-cols-3 grid-rows-3 overflow-hidden rounded-xl border-2 border-yellow-400 shadow-[0_0_0_999px_rgba(0,0,0,0.28)]">
                {Array.from({ length: 9 }, (_, index) => (
                  <div key={index} className="relative border border-yellow-400/70">
                    <span className="absolute left-1 top-1 rounded bg-slate-950/70 px-1.5 py-0.5 text-xs font-bold text-yellow-300">{index + 1}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button onClick={startCamera} disabled={scanning || saving} className="rounded-xl bg-slate-700 px-6 py-4 font-bold disabled:opacity-50">
              {cameraOn ? "Restart Camera" : "Start Camera"}
            </button>
            <button onClick={captureCard} disabled={!cameraOn || scanning || saving || hasUnconfirmedResults} className="rounded-xl bg-yellow-400 px-6 py-4 font-bold text-black disabled:opacity-50">
              {scanning ? "Scanning…" : scanMode === "binder" ? "Scan Binder Page" : "Scan Card"}
            </button>
          </div>

          <label className="mt-3 block cursor-pointer rounded-xl bg-slate-800 px-6 py-4 text-center font-bold">
            {scanMode === "binder" ? "Or choose a binder-page photo" : "Or choose a card photo"}
            <input type="file" accept="image/*" capture="environment" className="hidden" disabled={scanning || saving || hasUnconfirmedResults} onChange={(event) => { void choosePhoto(event.target.files?.[0]); event.currentTarget.value = ""; }} />
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
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button onClick={() => addRapidCard(false)} disabled={saving} className="rounded-xl bg-green-400 px-3 py-3 font-bold text-slate-950 disabled:opacity-50">Normal +1</button>
                  <button onClick={() => addRapidCard(true)} disabled={saving} className="rounded-xl bg-sky-400 px-3 py-3 font-bold text-slate-950 disabled:opacity-50">Foil +1</button>
                </div>
                <button onClick={useMatchedCard} disabled={saving} className="mt-2 w-full rounded-xl bg-slate-700 px-3 py-3 font-semibold text-white disabled:opacity-50">Review details</button>
              </div>
            </article>
          )}

          {scanMode === "binder" && binderMatches.length > 0 && (
            <section className="mt-5 rounded-2xl border border-yellow-400 bg-slate-950 p-3 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold uppercase tracking-wider text-green-400">Page results</p>
                  <h2 className="text-2xl font-bold">{binderMatches.length} card{binderMatches.length === 1 ? "" : "s"} matched</h2>
                </div>
                <button type="button" onClick={discardBinderResults} disabled={saving} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-300 disabled:opacity-50">Discard</button>
              </div>

              {missedSlots.length > 0 && (
                <p className="mt-3 rounded-lg bg-amber-950/60 p-3 text-sm text-amber-200">
                  No match in pocket{missedSlots.length === 1 ? "" : "s"}: {missedSlots.join(", ")}. Empty pockets can be ignored.
                </p>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {binderMatches.map((match) => (
                  <article key={match.slot} className="grid grid-cols-[64px_1fr] gap-3 rounded-xl bg-slate-900 p-3">
                    {/* Dynamic Lorcast card art is intentionally loaded directly. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={match.card.image_uris?.digital?.small || ""} alt={`${match.card.name} Lorcana card`} className="w-16 rounded-md" />
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase text-yellow-400">Pocket {match.slot}</p>
                      <h3 className="truncate font-bold">{[match.card.name, match.card.version].filter(Boolean).join(" — ")}</h3>
                      <p className="truncate text-xs text-slate-400">{match.card.set.name} · #{match.card.collector_number}</p>
                      <div className="mt-2 grid grid-cols-2 gap-1">
                        <button type="button" onClick={() => setBinderFoil(match.slot, false)} aria-pressed={!match.foil} className={`rounded-lg px-2 py-2 text-xs font-bold ${!match.foil ? "bg-green-400 text-slate-950" : "bg-slate-700 text-slate-200"}`}>Normal</button>
                        <button type="button" onClick={() => setBinderFoil(match.slot, true)} aria-pressed={match.foil} className={`rounded-lg px-2 py-2 text-xs font-bold ${match.foil ? "bg-sky-400 text-slate-950" : "bg-slate-700 text-slate-200"}`}>Foil</button>
                      </div>
                      <button type="button" onClick={() => removeBinderMatch(match.slot)} className="mt-2 text-xs font-semibold text-red-300">Remove wrong match</button>
                    </div>
                  </article>
                ))}
              </div>

              <button type="button" onClick={addBinderPage} disabled={saving} className="mt-4 w-full rounded-xl bg-yellow-400 px-6 py-4 font-bold text-slate-950 disabled:opacity-50">
                {saving ? "Saving…" : `Add ${binderMatches.length} card${binderMatches.length === 1 ? "" : "s"} to Vault`}
              </button>
            </section>
          )}

          {capturedImage && !matchedCard && (scanMode === "single" || binderMatches.length === 0) && (
            <details className="mt-5 text-slate-300">
              <summary className="cursor-pointer font-semibold">{scanMode === "binder" ? "Show captured binder page" : "Show captured image and recognised text"}</summary>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={capturedImage} alt="Captured Lorcana card" className="mt-3 w-full rounded-xl border border-slate-700" />
              {scanMode === "single" && <textarea value={ocrText} onChange={(event) => setOcrText(event.target.value)} className="mt-3 min-h-32 w-full rounded-xl border border-slate-700 bg-slate-800 p-3" />}
            </details>
          )}

          <canvas ref={canvasRef} className="hidden" />
        </section>
      </div>
    </main>
  );
}
