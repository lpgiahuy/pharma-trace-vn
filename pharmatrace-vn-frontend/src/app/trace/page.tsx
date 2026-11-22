'use client';

import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { App } from 'antd';
import { ListOrdered, Loader2, ScanLine, Search, Upload } from 'lucide-react';
import { Navbar } from '@/components/common/Navbar';
import { QrScanner, scanQrImage } from '@/components/trace/QrScanner';
import { FOCUS, TILE, TraceResult } from '@/components/trace/TraceResult';
import {
  traceService, type ScanLocation, type ScanOutcome, type TraceHistory, type VerifyResult,
} from '@/services/trace.service';
import { readTraceCode } from '@/utils/trace-code';
import { getDeviceId, readOwn, rememberVerification, type OwnRecord } from '@/utils/trace-owner';
import { workflowErrorMessage } from '@/utils/workflow-error';

interface Recent { uid: string; medicine: string }
type LookupError = { type: 'not_found' | 'invalid' | 'network'; message?: string };

const RECENT_KEY = 'pharma_trace_recent';
const SECONDARY = `inline-flex h-12 cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-5 text-sm font-semibold text-brand-500 hover:bg-brand-50 ${FOCUS}`;
const ERRORS: Record<LookupError['type'], { title: string; text: string }> = {
  not_found: { title: 'No box matches this code', text: 'Check the code against the one printed on the box. If it is correct, the box may not be registered, so ask your pharmacist.' },
  invalid: { title: 'This is not a box code', text: 'A box code looks like 0552e515-a070-4763-bc07-6a999e58f9d2. You can also paste the link from the QR code.' },
  network: { title: 'The server did not answer', text: 'Check your connection and try again.' },
};
const STEPS = [
  'Enter the box code, or scan the QR code printed on the box.',
  'Read the verdict and the journey of the box from the factory.',
  'Scratch the label inside the box and enter the secret code to confirm it is genuine.',
];

const recentListeners = new Set<() => void>();

function subscribeRecents(listener: () => void) {
  recentListeners.add(listener);
  return () => { recentListeners.delete(listener); };
}

function recentsSnapshot(): string {
  try {
    return localStorage.getItem(RECENT_KEY) ?? '[]';
  } catch {
    return '[]';
  }
}

function readRecents(): Recent[] {
  try {
    return JSON.parse(recentsSnapshot()) as Recent[];
  } catch {
    return [];
  }
}

function writeRecents(recents: Recent[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
  } catch {
    // Private browsing can block storage; the list is only a convenience.
  }
  recentListeners.forEach(listener => listener());
}

function currentLocation(): Promise<ScanLocation | undefined> {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(undefined);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      () => resolve(undefined),
      { timeout: 5000 },
    );
  });
}

function takeFragment(): { uid: string; code: string } | undefined {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const uid = fragment.get('uid');
  if (!uid) return undefined;
  window.history.replaceState(null, '', window.location.pathname);
  return { uid, code: fragment.get('code') ?? '' };
}

function lookupError(err: unknown): LookupError {
  const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
  if (code === 'TR_BOX_NOT_FOUND') return { type: 'not_found' };
  if (code === 'VALIDATION_FAILED') return { type: 'invalid' };
  return { type: 'network', message: workflowErrorMessage(err, '') || undefined };
}

export default function TracePage() {
  const { message } = App.useApp();
  const inputId = useId();
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<TraceHistory>();
  const [verification, setVerification] = useState<VerifyResult>();
  const [scan, setScan] = useState<ScanOutcome>();
  const [own, setOwn] = useState<OwnRecord>();
  const [located, setLocated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<LookupError>();
  const [camera, setCamera] = useState(false);
  const storedRecents = useSyncExternalStore(subscribeRecents, recentsSnapshot, () => '[]');
  const recents = useMemo(() => JSON.parse(storedRecents) as Recent[], [storedRecents]);

  const lookup = useCallback((uid: string, code: string) => traceService.history(uid).then(async res => {
    setHistory(res.data);
    setOwn(readOwn(uid));
    setBusy(false);
    setChecking(true);
    const next = [{ uid, medicine: res.data.box.medicineName }, ...readRecents().filter(recent => recent.uid !== uid)].slice(0, 5);
    writeRecents(next);
    try {
      const location = await currentLocation();
      const [scanned, verified] = await Promise.all([
        traceService.scan(uid, location),
        code ? traceService.verify(uid, code, getDeviceId()) : undefined,
      ]);
      setLocated(!!location);
      setScan(scanned.data);
      setVerification(verified?.data);
      if (verified) setOwn(rememberVerification(uid, verified.data));
      if (verified?.data.status === 'FIRST_ACTIVATION') setHistory((await traceService.history(uid)).data);
    } catch (err: unknown) {
      message.error(workflowErrorMessage(err, 'Could not complete the security checks.'));
    } finally {
      setChecking(false);
    }
  }, err => setError(lookupError(err))).finally(() => setBusy(false)), [message]);

  const run = useCallback((uid: string, code = '') => {
    setBusy(true);
    setCamera(false);
    setError(undefined);
    setHistory(undefined);
    setVerification(undefined);
    setScan(undefined);
    setOwn(undefined);
    setInput(uid);
    void lookup(uid, code);
  }, [lookup]);

  const verify = (code: string) => {
    if (!history) return;
    setVerifying(true);
    void traceService.verify(history.box.uid, code, getDeviceId())
      .then(async res => {
        setVerification(res.data);
        setOwn(rememberVerification(history.box.uid, res.data));
        if (res.data.status === 'FIRST_ACTIVATION') setHistory((await traceService.history(history.box.uid)).data);
      })
      .catch((err: unknown) => message.error(workflowErrorMessage(err, 'Could not verify this code.')))
      .finally(() => setVerifying(false));
  };

  const reset = () => {
    setHistory(undefined);
    setVerification(undefined);
    setScan(undefined);
    setError(undefined);
    setInput('');
  };

  const onScanned = (text: string) => {
    const read = readTraceCode(text);
    setCamera(false);
    if (read?.uid) run(read.uid, read.code ?? '');
    else if (read?.code && history) verify(read.code);
    else message.warning(read?.code ? 'Scan the QR code on the box first.' : 'This QR code is not a PharmaTrace code.');
  };

  const onImage = (file?: File) => {
    if (!file) return;
    setBusy(true);
    void scanQrImage(file)
      .then(onScanned)
      .catch(() => message.error('No QR code found in this image.'))
      .finally(() => setBusy(false));
  };

  const submit = () => {
    const read = readTraceCode(input);
    if (read?.uid) run(read.uid, read.code ?? '');
    else setError({ type: 'invalid' });
  };

  useEffect(() => {
    const first = takeFragment();
    if (first) void lookup(first.uid, first.code);
    const onHashChange = () => {
      const next = takeFragment();
      if (next) run(next.uid, next.code);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [lookup, run]);

  const failure = error && ERRORS[error.type];
  const idle = !busy && !error && !history;
  const showingResult = !!history && !busy && !error;

  return (
    <div className="min-h-screen bg-surface-DEFAULT text-gray-800">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        <h1 className="max-w-2xl text-3xl font-bold leading-tight tracking-tight text-balance sm:text-4xl">Is this box of medicine genuine?</h1>
        <p className="mt-3 max-w-2xl text-lg/relaxed text-gray-700">Look up the box code to see where it came from, then confirm it with the secret code under the scratch label.</p>

        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className={`flex flex-col gap-4 ${idle ? 'lg:col-span-7' : 'lg:col-span-12'}`}>
          <form className={TILE} onSubmit={event => { event.preventDefault(); submit(); }}>
            <label htmlFor={inputId} className="text-base font-bold">Box code</label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <input
                id={inputId}
                value={input}
                onChange={event => setInput(event.target.value)}
                placeholder="Paste the code or the link from the QR code"
                autoComplete="off"
                spellCheck={false}
                className={`h-12 min-w-0 rounded-md border border-gray-300 bg-gray-50 px-4 font-mono text-sm text-gray-800 placeholder:font-sans placeholder:text-gray-500 sm:flex-1 ${FOCUS}`}
              />
              <button type="submit" disabled={busy || !input.trim()} className={`flex h-12 items-center justify-center gap-2 rounded-md bg-brand-500 px-7 text-sm font-bold text-white hover:bg-brand-600 disabled:opacity-50 ${FOCUS}`}>
                <Search className="h-4 w-4" aria-hidden /> Look up
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="text-sm text-gray-600">or</span>
              <button type="button" onClick={() => setCamera(open => !open)} aria-expanded={camera} className={SECONDARY}>
                <ScanLine className="h-4 w-4" aria-hidden /> {camera ? 'Close camera' : 'Scan with camera'}
              </button>
              <label className={`${SECONDARY} has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand-500`}>
                <Upload className="h-4 w-4" aria-hidden /> Upload a QR image
                <input type="file" accept="image/*" className="sr-only" onChange={event => { onImage(event.target.files?.[0]); event.target.value = ''; }} />
              </label>
            </div>
            {camera && <div className="mt-4"><QrScanner onRead={onScanned} /></div>}
          </form>

          {idle && recents.length > 0 && (
            <section className={TILE}>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-base font-bold">Recent lookups</h2>
                <button onClick={() => writeRecents([])} className={`rounded text-sm text-gray-600 underline underline-offset-2 hover:text-gray-800 ${FOCUS}`}>Clear</button>
              </div>
              <ul className="divide-y divide-surface-border">
                {recents.map(recent => (
                  <li key={recent.uid}>
                    <button onClick={() => run(recent.uid)} className={`flex min-h-12 w-full items-center justify-between gap-4 rounded-md px-2 py-2 text-left hover:bg-brand-50 ${FOCUS}`}>
                      <span className="truncate font-medium">{recent.medicine}</span>
                      <span className="shrink-0 font-mono text-sm text-gray-600">{recent.uid.slice(0, 8)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          </div>

          {idle && (
            <section className={`${TILE} lg:col-span-5`}>
              <h2 className="mb-4 flex items-center gap-2.5 text-base font-bold">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-50 text-brand-500"><ListOrdered className="h-4 w-4" aria-hidden /></span>
                How it works
              </h2>
              <ol className="space-y-4">
                {STEPS.map((step, index) => (
                  <li key={step} className="flex gap-4">
                    <span className="w-8 shrink-0 text-3xl font-bold leading-none text-brand-500" aria-hidden>{index + 1}</span>
                    <p className="text-sm/relaxed text-gray-700">{step}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {busy && (
            <p className={`${TILE} flex items-center gap-3 text-gray-700 lg:col-span-12`} role="status">
              <Loader2 className="h-5 w-5 animate-spin text-brand-500 motion-reduce:animate-none" aria-hidden /> Looking up the box…
            </p>
          )}

          {!busy && failure && (
            <section className="rounded-xl bg-medical-orange p-6 text-white sm:p-8 lg:col-span-12" role="alert">
              <h2 className="text-2xl font-bold text-inherit!">{failure.title}</h2>
              <p className="mt-2 max-w-2xl text-base/relaxed">{error.message ?? failure.text}</p>
              <button onClick={reset} className="mt-4 h-11 rounded-md bg-current/15 px-5 text-sm font-bold hover:bg-current/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">Clear and try again</button>
            </section>
          )}

          {showingResult && (
            <TraceResult history={history} verification={verification} scan={scan} own={own} located={located} checking={checking} verifying={verifying} onVerify={verify} onReset={reset} />
          )}
        </div>
      </main>
    </div>
  );
}
