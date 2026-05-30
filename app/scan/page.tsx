"use client";

import { useRef, useState } from "react";
import Link from "next/link";

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState("");

  async function startCamera() {
    try {
      setError("");

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraOn(true);
      }
    } catch {
      setError("Camera access failed. On iPhone this needs HTTPS or an installed PWA.");
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6">
      <Link href="/" className="text-yellow-400">
        ← Back to Vault
      </Link>

      <h1 className="text-4xl font-bold my-4">📷 Scan Cards</h1>

      <div className="bg-slate-900 rounded-xl p-4">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full max-w-xl rounded-xl bg-black mb-4"
        />

        {!cameraOn && (
          <button
            onClick={startCamera}
            className="bg-yellow-400 text-black font-bold px-6 py-3 rounded-xl"
          >
            Start Camera
          </button>
        )}

        {cameraOn && (
          <p className="text-green-400 font-bold">
            Camera active. Next step: OCR card recognition.
          </p>
        )}

        {error && <p className="text-red-400 mt-4">{error}</p>}
      </div>
    </main>
  );
}