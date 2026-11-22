'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  CheckCircle2, Factory, KeyRound, Loader2, MinusCircle, Package, PackageCheck, ShieldAlert, ShieldCheck, ShieldX, Truck, Warehouse, XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { ScanOutcome, TraceBox, TraceEvent, TraceHistory, VerifyResult } from '@/services/trace.service';
import { formatDate, formatDateTime } from '@/utils';
import type { OwnRecord } from '@/utils/trace-owner';
import { assessTrace, isFlagged, type StatusKey } from '@/utils/trace-status';

type Tone = 'green' | 'amber' | 'red' | 'info';

const TONES: Record<Tone, string> = {
  green: 'bg-medical-green text-white',
  amber: 'bg-medical-orange text-white',
  red: 'bg-red-600 text-white',
  info: 'bg-brand-500 text-white',
};

interface StatusStyle { label: string; tone: Tone; Icon: LucideIcon; message: (box: TraceBox, verification?: VerifyResult, own?: OwnRecord) => string }

const STATUS: Record<StatusKey, StatusStyle> = {
  recalled: { label: 'Do not use: this batch was recalled', tone: 'red', Icon: ShieldX, message: () => 'The manufacturer or the authority recalled this batch. Return the box to your pharmacy for a refund.' },
  expired: { label: 'Do not use: this medicine has expired', tone: 'red', Icon: ShieldX, message: box => `The expiry date was ${formatDate(box.expiryDate)}. Do not take it.` },
  invalid_code: { label: 'The secret code is wrong', tone: 'red', Icon: ShieldX, message: () => 'The code does not match this box. Check the digits once more. If they are right, the box may be counterfeit, so do not use it and tell your pharmacist.' },
  counterfeit: {
    label: 'Counterfeit warning: do not use this medicine', tone: 'red', Icon: ShieldX,
    message: () => 'This box code was used in a way a real box cannot be, such as being scanned in places too far apart too quickly or used many times within a minute. Treat the box as counterfeit, do not use it, and tell your pharmacist.',
  },
  already_activated: {
    label: 'The code was already used', tone: 'amber', Icon: ShieldAlert,
    message: (_box, verification) => `The code is correct, but it was first verified on ${formatDateTime(verification?.activatedAt)} and has been entered ${verification?.verifyCount ?? 0} times. If that was not you, the box may be a copy.`,
  },
  activated_before: {
    label: 'The code was already used', tone: 'amber', Icon: ShieldAlert,
    message: box => `The secret code of this box was first verified on ${formatDateTime(box.activatedAt)}. If the box is new to you, it may be a copy.`,
  },
  used_by_others: {
    label: 'The code was also entered by someone else', tone: 'amber', Icon: ShieldAlert,
    message: (box, verification, own) => `You verified this box on ${formatDateTime(own?.activatedAt)}, but its code has been entered ${verification?.verifyCount ?? box.verifyCount} times and you entered it ${own?.count ?? 0}. If you did not share this box, it may be a copy.`,
  },
  activated_by_you: {
    label: 'Genuine: you already verified this box', tone: 'green', Icon: ShieldCheck,
    message: (_box, _verification, own) => `You verified this box on ${formatDateTime(own?.activatedAt)}. Nobody else has entered its secret code.`,
  },
  authentic: { label: 'Genuine: verified for the first time', tone: 'green', Icon: ShieldCheck, message: () => 'The secret code is correct and this was the first time it was used. The box is now marked as activated.' },
  code_required: { label: 'Box found. Now confirm the secret code', tone: 'info', Icon: ShieldAlert, message: () => 'The box code is registered, but only the secret code under the scratch label proves this particular box is genuine.' },
};

const EVENTS: Record<TraceEvent['eventType'], { label: string; Icon: LucideIcon }> = {
  MANUFACTURED: { label: 'Manufactured', Icon: Factory },
  RECEIVED: { label: 'Received at', Icon: Package },
  TRANSFER_DISPATCHED: { label: 'Dispatched from', Icon: Truck },
  TRANSFER_RECEIVED: { label: 'Received by transfer at', Icon: Warehouse },
  PACKED: { label: 'Packed for an order at', Icon: PackageCheck },
  HANDED_OVER: { label: 'Handed to the courier at', Icon: Truck },
  DELIVERED: { label: 'Delivered to the customer', Icon: CheckCircle2 },
  CODE_ACTIVATED: { label: 'Secret code activated', Icon: KeyRound },
};

export const TILE = 'rounded-xl border border-surface-border bg-white p-5 shadow-card sm:p-6';
export const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500';

function TileTitle({ icon: Icon, children, aside }: { icon: LucideIcon; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2.5 text-base font-bold text-gray-800">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-50 text-brand-500"><Icon className="h-4 w-4" aria-hidden /></span>
        {children}
      </h2>
      {aside}
    </div>
  );
}

function Verdict({ statuses, box, verification, own, onReset }: { statuses: StatusKey[]; box: TraceBox; verification?: VerifyResult; own?: OwnRecord; onReset: () => void }) {
  const [primary, ...others] = statuses;
  const style = STATUS[primary];
  return (
    <section className={`rounded-xl p-6 sm:p-8 lg:col-span-12 ${TONES[style.tone]}`} role="status">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-current/15"><style.Icon className="h-9 w-9" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold leading-tight text-inherit! text-balance sm:text-3xl">{style.label}</h2>
          <p className="mt-2 max-w-2xl text-base/relaxed">{style.message(box, verification, own)}</p>
          <p className="mt-4 text-sm font-medium">{box.medicineName} · batch <span className="font-mono">{box.batchNumber}</span></p>
          {others.length > 0 && (
            <ul className="mt-4 max-w-2xl space-y-2 border-t border-current/25 pt-4 text-sm/relaxed">
              {others.map(key => <li key={key}><span className="font-bold">{STATUS[key].label}.</span> {STATUS[key].message(box, verification, own)}</li>)}
            </ul>
          )}
        </div>
        <button onClick={onReset} className={`h-11 shrink-0 self-start rounded-md bg-current/15 px-5 text-sm font-bold hover:bg-current/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current`}>
          Check another box
        </button>
      </div>
    </section>
  );
}

function SecretCode({ verification, activatedAt, verifying, onVerify }: { verification?: VerifyResult; activatedAt: string | null; verifying: boolean; onVerify: (code: string) => void }) {
  const inputId = useId();
  const [code, setCode] = useState('');
  const needsCode = !verification || verification.status === 'INVALID_CODE';
  const activated = verification?.activatedAt ?? activatedAt;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onVerify(code.trim());
  };
  return (
    <section className={`${TILE} lg:col-span-12`}>
      <div>
        <TileTitle icon={KeyRound}>Secret code</TileTitle>
        <p className="text-sm/relaxed text-gray-600">Scratch the label inside the box and type the code under it. It proves this exact box is real.</p>
        {needsCode ? (
          <form onSubmit={submit} className="mt-5 w-full max-w-2xl">
            <label htmlFor={inputId} className="block text-sm font-semibold text-gray-800">Code under the scratch label</label>
            <div className="mt-1.5 flex flex-col gap-3 sm:flex-row">
              <input
                id={inputId}
                value={code}
                onChange={event => setCode(event.target.value)}
                spellCheck={false}
                autoComplete="off"
                className={`h-12 min-w-0 rounded-md border border-gray-300 bg-gray-50 px-4 font-mono text-sm text-gray-800 sm:flex-1 ${FOCUS}`}
              />
              <button type="submit" disabled={verifying || !code.trim()} className={`flex h-12 items-center justify-center gap-2 rounded-md bg-brand-500 px-6 text-sm font-bold text-white hover:bg-brand-600 disabled:opacity-50 ${FOCUS}`}>
                {verifying && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />} Verify code
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-5 flex w-full max-w-2xl items-start gap-3 rounded-lg bg-green-50 p-4">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-medical-green" aria-hidden />
            <div>
              <p className="font-bold text-green-900">Code is correct</p>
              <p className="mt-0.5 text-sm/relaxed text-gray-700">Entered {verification.verifyCount} {verification.verifyCount === 1 ? 'time' : 'times'}{activated ? `, first on ${formatDateTime(activated)}` : ''}.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Product({ box }: { box: TraceBox }) {
  const [now] = useState(Date.now);
  const daysLeft = Math.floor((new Date(box.expiryDate).getTime() - now) / 86_400_000);
  const facts: [string, string, string?][] = [
    ['Batch', box.batchNumber, 'font-mono'],
    ['Produced', formatDate(box.productionDate)],
    ['Expires', formatDate(box.expiryDate), daysLeft < 90 ? 'text-red-600' : undefined],
    ['Time left', daysLeft < 0 ? 'Expired' : `${daysLeft} days`, daysLeft < 90 ? 'text-red-600' : undefined],
  ];
  return (
    <section className={`${TILE} lg:col-span-12`}>
      <h2 className="max-w-4xl text-2xl font-bold leading-snug text-gray-800 text-balance">{box.medicineName}</h2>
      <p className="mt-1 text-gray-600">{box.manufacturer ?? 'Manufacturer not recorded'} · batch {box.batchStatus.replace('_', ' ').toLowerCase()}</p>
      <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {facts.map(([label, value, style]) => (
          <div key={label} className="rounded-lg bg-brand-50 p-4">
            <dt className="text-sm text-gray-600">{label}</dt>
            <dd className={`mt-1 break-words text-base font-bold text-gray-800 ${style ?? ''}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 break-all text-sm text-gray-600">Box code <span className="font-mono text-gray-800">{box.uid}</span></p>
    </section>
  );
}

function Journey({ timeline }: { timeline: TraceEvent[] }) {
  return (
    <section className={`${TILE} lg:col-span-12`}>
      <TileTitle icon={Truck} aside={<span className="text-sm text-gray-600">{timeline.length} {timeline.length === 1 ? 'step' : 'steps'}</span>}>Journey of this box</TileTitle>
      <ol>
        {timeline.map((event, index) => {
          const { label, Icon } = EVENTS[event.eventType];
          return (
            <li key={`${event.eventType}-${event.occurredAt}`} className="relative flex gap-4 pb-6 last:pb-0">
              {index < timeline.length - 1 && <span className="absolute bottom-0 left-4 top-9 w-0.5 -translate-x-1/2 bg-brand-100" aria-hidden />}
              <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white"><Icon className="h-3.5 w-3.5" aria-hidden /></span>
              <div className="min-w-0">
                <p className="font-semibold text-gray-800">{label}{event.facilityName ? ` ${event.facilityName}` : ''}</p>
                <time dateTime={event.occurredAt} className="text-sm tabular-nums text-gray-600">{formatDateTime(event.occurredAt)}</time>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Check({ label, detail, state }: { label: string; detail: string; state: 'pass' | 'fail' | 'skip' }) {
  const result = {
    pass: { Icon: CheckCircle2, text: 'Passed', style: 'text-medical-green' },
    fail: { Icon: XCircle, text: 'Failed', style: 'text-red-600' },
    skip: { Icon: MinusCircle, text: 'Not checked', style: 'text-gray-600' },
  }[state];
  return (
    <li className="rounded-lg border border-surface-border p-4">
      <span className={`flex items-center gap-1.5 text-sm font-bold ${result.style}`}><result.Icon className="h-4 w-4" aria-hidden /> {result.text}</span>
      <p className="mt-2 font-semibold text-gray-800">{label}</p>
      <p className="mt-0.5 text-sm/relaxed text-gray-600">{detail}</p>
    </li>
  );
}

function Checks({ verification, scan, located, flagged }: { verification?: VerifyResult; scan?: ScanOutcome; located: boolean; flagged: boolean }) {
  const reasons = scan?.reasons ?? [];
  return (
    <section className={`${TILE} lg:col-span-12`}>
      <TileTitle icon={ShieldCheck}>Anti-counterfeit checks</TileTitle>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Check label="Secret code" detail="Matches the signature the manufacturer put on this box." state={!verification ? 'skip' : verification.status === 'INVALID_CODE' ? 'fail' : 'pass'} />
        <Check label="Scan frequency" detail="Fails if the box is scanned 10 times within a minute." state={!scan ? 'skip' : reasons.includes('EXCESSIVE_SCANS') ? 'fail' : 'pass'} />
        <Check
          label="Travel between scans"
          detail={located ? 'Fails if two scans are too far apart to be one box (over 1000 km/h).' : 'Allow location access to compare this scan with earlier ones.'}
          state={reasons.includes('IMPOSSIBLE_TRAVEL') ? 'fail' : scan && located ? 'pass' : 'skip'}
        />
        <li className={`rounded-lg p-4 ${flagged ? 'bg-red-600 text-white' : 'bg-brand-50'}`}>
          <p className={`text-sm ${flagged ? 'text-white' : 'text-gray-600'}`}>Result</p>
          <p className={`mt-2 text-lg font-bold ${flagged ? 'text-white' : 'text-gray-800'}`}>{flagged ? 'Flagged as counterfeit' : 'No sign of copying'}</p>
          <p className={`mt-0.5 text-sm/relaxed ${flagged ? 'text-white' : 'text-gray-600'}`}>
            {flagged ? 'This box code is flagged until an administrator reviews it.' : 'A box is flagged if its code is used 10 times in a minute or in two places too far apart.'}
          </p>
        </li>
      </ul>
    </section>
  );
}

interface Props {
  history: TraceHistory;
  verification?: VerifyResult;
  scan?: ScanOutcome;
  own?: OwnRecord;
  located: boolean;
  checking: boolean;
  verifying: boolean;
  onVerify: (code: string) => void;
  onReset: () => void;
}

export function TraceResult({ history, verification, scan, own, located, checking, verifying, onVerify, onReset }: Props) {
  const { box, timeline } = history;
  return (
    <>
      {checking ? (
        <p className="flex items-center gap-4 rounded-xl bg-brand-500 p-6 text-white sm:p-8 lg:col-span-12" role="status">
          <Loader2 className="h-6 w-6 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
          <span className="text-xl font-bold">Running the security checks…</span>
        </p>
      ) : (
        <Verdict statuses={assessTrace(box, verification, scan, own)} box={box} verification={verification} own={own} onReset={onReset} />
      )}
      <SecretCode key={verification?.status ?? 'none'} verification={verification} activatedAt={box.activatedAt} verifying={verifying} onVerify={onVerify} />
      <Product box={box} />
      <Checks verification={verification} scan={scan} located={located} flagged={isFlagged(box, verification, scan)} />
      <Journey timeline={timeline} />
    </>
  );
}
