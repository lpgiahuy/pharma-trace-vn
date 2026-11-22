'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Html5Qrcode } from 'html5-qrcode';

const FRAME = 250;

export async function scanQrImage(file: File): Promise<string> {
  const { Html5Qrcode } = await import('html5-qrcode');
  const holder = document.createElement('div');
  holder.id = `trace-file-reader-${Date.now()}`;
  holder.hidden = true;
  document.body.appendChild(holder);
  const reader = new Html5Qrcode(holder.id, false);
  try {
    return await reader.scanFile(file, false);
  } finally {
    reader.clear();
    holder.remove();
  }
}

export function QrScanner({ onRead }: { onRead: (text: string) => void }) {
  const id = `trace-reader-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const onReadRef = useRef(onRead);
  const [state, setState] = useState<'starting' | 'running' | 'error'>('starting');
  const [error, setError] = useState('');

  useEffect(() => {
    onReadRef.current = onRead;
  }, [onRead]);

  useEffect(() => {
    let cancelled = false;
    let scanner: Html5Qrcode | undefined;

    const start = async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('SECURE_CONTEXT');
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
        if (cancelled) return;
        scanner = new Html5Qrcode(id, { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: FRAME, height: FRAME } },
          text => {
            if (cancelled) return;
            cancelled = true;
            onReadRef.current(text);
          },
          () => {},
        );
        if (!cancelled) setState('running');
      } catch (cause) {
        if (cancelled) return;
        const detail = String(cause);
        setError(/SECURE_CONTEXT/.test(detail)
          ? 'The camera needs HTTPS or localhost. Type the box code or upload a QR image instead.'
          : /NotAllowed|Permission|denied/i.test(detail)
            ? 'Camera access is blocked. Allow it in your browser settings and try again, or type the box code instead.'
            : /NotFound|DevicesNotFound|Overconstrained/i.test(detail)
              ? 'No camera found on this device. Type the box code or upload a QR image instead.'
              : 'The camera could not start. Close other apps that may be using it and try again.');
        setState('error');
      }
    };

    const starting = start();
    return () => {
      cancelled = true;
      void starting.then(async () => {
        if (!scanner) return;
        try {
          if (scanner.isScanning) await scanner.stop();
          scanner.clear();
        } catch {
          // The reader may already be gone when the panel closes.
        }
      });
    };
  }, [id]);

  if (state === 'error') {
    return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">{error}</p>;
  }

  return (
    <div className="relative overflow-hidden rounded-lg bg-brand-900">
      <style>{'@keyframes trace-scan { 0%, 100% { transform: translateY(-110px) } 50% { transform: translateY(110px) } }'}</style>
      <div id={id} className="min-h-64 w-full [&_video]:w-full [&_video]:object-cover" />
      {state === 'running' && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[calc(100%-2.5rem)] items-center justify-center" aria-hidden>
          <div className="relative h-[250px] w-[250px]">
            <span className="absolute left-0 top-0 h-6 w-6 border-l-2 border-t-2 border-white" />
            <span className="absolute right-0 top-0 h-6 w-6 border-r-2 border-t-2 border-white" />
            <span className="absolute bottom-0 left-0 h-6 w-6 border-b-2 border-l-2 border-white" />
            <span className="absolute bottom-0 right-0 h-6 w-6 border-b-2 border-r-2 border-white" />
            <span className="absolute left-2 right-2 top-1/2 h-px bg-white/80 [animation:trace-scan_2.4s_ease-in-out_infinite] motion-reduce:hidden" />
          </div>
        </div>
      )}
      {state === 'starting' && (
        <p className="flex items-center gap-2 px-4 py-5 text-sm text-gray-200" role="status">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Starting the camera. Allow access when your browser asks.
        </p>
      )}
      {state === 'running' && <p className="px-4 py-2.5 text-sm text-gray-200">Hold the QR code on the box inside the corners.</p>}
    </div>
  );
}
