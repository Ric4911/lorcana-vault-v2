"use client";

import Link from "next/link";
import { useRef, useState } from "react";

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function startCamera() {
    try {
      setError("");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraOn(true);
      }
    } catch {
      setError("Camera could not be started. Check browser camera permission.");
    }
  }

  function captureCard() {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = canvas.toDataURL("image/jpeg", 0.9);
    setCapturedImage(imageData);
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6">
      <Link href="/" className="text-yellow-400 text-xl">
        ← Back to Vault
      </Link>

      <h1 className="text-5xl font-bold mt-8 mb-8">📷 Scan Cards</h1>

      <div className="bg-slate-900 rounded-2xl p-5">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full rounded-xl bg-black"
        />

        <div className="flex gap-4 mt-6">
          {!cameraOn && (
            <button
              onClick={startCamera}
              className="bg-yellow-400 text-black font-bold px-8 py-4 rounded-xl"
            >
              Start Camera
            </button>
          )}

          {cameraOn && (
            <button
              onClick={captureCard}
              className="bg-yellow-400 text-black font-bold px-8 py-4 rounded-xl"
            >
              Capture Card
            </button>
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />

        {capturedImage && (
          <div className="mt-6">
            <p className="text-green-400 font-bold mb-3">Card photo captured ✅</p>
            <img
              src={capturedImage}
              alt="Captured Lorcana card"
              className="w-full rounded-xl border border-slate-700"
            />
          </div>
        )}

        {error && <p className="text-red-400 mt-4">{error}</p>}
      </div>
    </main>
  );
}