'use client';

import { useId, useState } from 'react';
import { App, Button } from 'antd';
import { QrScanner, scanQrImage } from '@/components/trace/QrScanner';

export type ScannedCode = { kind: 'uid' | 'sscc'; code: string };

/**
 * Reads what a printed label says. A box label carries a link with the box UID, a carton label the 18-digit SSCC.
 * Anything else is not a label of this system.
 */
export function classifyScan(text: string): ScannedCode | undefined {
  const uid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(text)?.[0].toLowerCase();
  if (uid) return { kind: 'uid', code: uid };
  const sscc = /^\s*(\d{18})\s*$/.exec(text)?.[1];
  return sscc ? { kind: 'sscc', code: sscc } : undefined;
}

/** Appends a code to a textarea value written as lines or comma separated codes, unless it is already there. */
export function appendCode(current: string | undefined, code: string): string {
  const existing = (current ?? '').split(/[\s,]+/).filter(Boolean);
  return existing.includes(code) ? existing.join('\n') : [...existing, code].join('\n');
}

/** Camera and image upload for scanning box and carton QR labels; the parent decides where each code goes. */
export function ScanToolbar({ onCode, hint }: { onCode: (scanned: ScannedCode) => void; hint?: string }) {
  const { message } = App.useApp();
  const inputId = `scan-images-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [camera, setCamera] = useState(false);

  const accept = (text: string, source: string) => {
    const scanned = classifyScan(text);
    if (scanned) onCode(scanned);
    else message.warning(`${source}: this QR code is not a box or carton label.`);
  };

  const readImages = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      try { accept(await scanQrImage(file), file.name); } catch { message.error(`No QR code found in ${file.name}.`); }
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="small" onClick={() => setCamera(open => !open)}>{camera ? 'Close camera' : 'Scan with camera'}</Button>
        <Button size="small" onClick={() => document.getElementById(inputId)?.click()}>Upload QR images</Button>
        <input id={inputId} type="file" accept="image/*" multiple hidden aria-label="QR images"
          onChange={event => { void readImages(event.target.files); event.target.value = ''; }} />
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
      {camera && <QrScanner onRead={text => { accept(text, 'Camera'); setCamera(false); }} />}
    </div>
  );
}
