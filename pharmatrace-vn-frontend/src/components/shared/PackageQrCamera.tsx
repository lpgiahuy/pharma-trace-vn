'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { LoadingOutlined } from '@ant-design/icons';
import type { Html5Qrcode } from 'html5-qrcode';
import styles from './OrderPackingModal.module.css';

/** Decode a package QR code from an uploaded image. Throws if no code is found. */
export async function scanPackageImage(file: File): Promise<string> {
  const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
  const holder = document.createElement('div');
  holder.id = `package-image-${Math.random().toString(36).slice(2)}`;
  holder.style.display = 'none';
  document.body.appendChild(holder);
  const scanner = new Html5Qrcode(holder.id, {
    formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.CODE_128],
    useBarCodeDetectorIfSupported: true,
    verbose: false,
  });
  try {
    return await scanner.scanFile(file, false);
  } finally {
    try { scanner.clear(); } catch { /* nothing to clear */ }
    holder.remove();
  }
}

interface Props {
  onRead: (code: string) => void;
}

export function PackageQrCamera({ onRead }: Props) {
  const id = `package-camera-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const onReadRef = useRef(onRead);
  const [state, setState] = useState<'starting' | 'running' | 'error'>('starting');
  const [error, setError] = useState('');

  useEffect(() => {
    onReadRef.current = onRead;
  }, [onRead]);

  useEffect(() => {
    let cancelled = false;
    let scanner: Html5Qrcode | undefined;
    let lastCode = '';

    const start = async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw new Error('Use HTTPS or localhost to open the camera. You can also use a USB scanner or enter the UID below.');
        }
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
        if (cancelled) return;
        scanner = new Html5Qrcode(id, {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.CODE_128],
          verbose: false,
          useBarCodeDetectorIfSupported: true,
        });
        // No qrbox: decode the whole frame so large or dense QR codes (e.g. on a phone screen) are not cropped.
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 15, videoConstraints: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } },
          (code) => {
            if (cancelled || code === lastCode) return;
            lastCode = code;
            onReadRef.current(code);
          },
          () => {},
        );
        if (!cancelled) setState('running');
      } catch (cause) {
        if (cancelled) return;
        const detail = String(cause);
        setError(/NotAllowed|Permission|denied/i.test(detail)
          ? 'Camera permission is blocked. Allow camera access in your browser, then try again.'
          : /NotFound|DevicesNotFound|Overconstrained/i.test(detail)
            ? 'No camera found. Connect a camera, use a USB scanner, or enter the UID below.'
            : cause instanceof Error && cause.message.startsWith('Use HTTPS')
              ? cause.message
              : 'Could not start the camera. Check that it is connected and not in use by another app.');
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
          // The reader may already be removed when the modal closes.
        }
      });
    };
  }, [id]);

  return (
    <div className={styles.cameraView}>
      <div id={id} className={styles.cameraReader} />
      {state === 'starting' && <div className={styles.cameraOverlay} role="status"><LoadingOutlined aria-hidden /><div>Opening camera…<p>Allow camera access in your browser to begin.</p></div></div>}
      {state === 'running' && <p className={styles.cameraCaption}>Hold the package QR code inside the frame.</p>}
      {state === 'error' && <div className={styles.cameraError} role="alert">{error}</div>}
    </div>
  );
}
