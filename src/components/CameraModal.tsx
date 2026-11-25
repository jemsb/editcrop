import React, { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, X } from 'lucide-react';

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (canvas: HTMLCanvasElement) => void;
}

export const CameraModal: React.FC<CameraModalProps> = ({
  isOpen,
  onClose,
  onCapture,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>(
    'environment'
  );
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setError(null);
    setReady(false);

    const startStream = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError(
          'Camera capture is not supported in this browser or context. Upload or paste an image instead.'
        );
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 2560 },
            height: { ideal: 1920 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Unable to access camera';
        setError(`Camera access unavailable: ${msg}`);
      }
    };

    startStream();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [isOpen, facingMode]);

  if (!isOpen) return null;

  const handleSnap = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    onCapture(canvas);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Camera Document Capture"
    >
      <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold tracking-tight text-white">
            Capture Document Photo
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setFacingMode((m) =>
                  m === 'environment' ? 'user' : 'environment'
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Switch Camera
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close camera"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="relative flex aspect-[4/3] w-full items-center justify-center bg-black">
          {error ? (
            <div className="max-w-md px-6 text-center text-sm text-slate-300">
              <p>{error}</p>
            </div>
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full object-contain"
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-800 px-5 py-3.5">
          <span className="text-xs text-slate-400">
            Position the A4 or A5 sheet inside the frame.
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!ready || Boolean(error)}
              onClick={handleSnap}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            >
              <Camera className="h-4 w-4" />
              Capture Frame
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
