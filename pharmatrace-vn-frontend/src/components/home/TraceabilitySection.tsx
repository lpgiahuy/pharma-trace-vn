import React from 'react';
import Link from 'next/link';
import { ShieldCheck, QrCode, ScanLine } from 'lucide-react';

export function TraceabilitySection() {
  return (
    <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-[#004084] to-[#002e5f] shadow-2xl shadow-blue-900/20">
      <div className="pointer-events-none absolute top-0 right-0 h-96 w-96 -translate-y-1/2 translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-64 w-64 translate-y-1/2 -translate-x-1/2 rounded-full bg-sky-400/20 blur-2xl" />

      <div className="relative z-10 flex flex-col lg:flex-row items-center gap-8 lg:gap-12 p-6 sm:p-10 md:p-14">
        <div className="flex-1 w-full text-white">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/15 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-100">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Guaranteed authentic
          </div>
          <h2 className="m-0 mb-5 text-2xl sm:text-4xl lg:text-5xl font-black leading-tight tracking-tight !text-white">
            Medicine traceability
            <br />
            <span className="bg-gradient-to-r from-white to-blue-200 bg-clip-text text-transparent">absolute transparency</span>
          </h2>
          <p className="m-0 mb-8 max-w-lg text-sm sm:text-lg leading-relaxed text-blue-100/80">
            Scan the QR code on the package to verify origin, batch and expiry — and protect your family from counterfeit medicines.
          </p>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-white/15 pt-6 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-blue-100">
            <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Transparency</span>
            <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-sky-300" /> Security</span>
            <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-300" /> Tamper-proof</span>
          </div>
        </div>

        <Link
          href="/trace"
          aria-label="Check a product now"
          className="group/card relative mt-2 flex w-full max-w-[280px] shrink-0 items-center justify-center sm:w-72 lg:w-80"
        >
          <div className="absolute inset-0 hidden rotate-6 rounded-3xl border border-white/10 bg-white/5 transition-transform duration-500 group-hover/card:rotate-12 sm:block" />
          <div className="relative z-10 flex w-full flex-col items-center rounded-3xl bg-white p-5 sm:p-6 shadow-2xl transition-transform duration-300 group-hover/card:scale-105">
            <div className="relative mb-4 flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border-4 border-slate-50 text-[#004996]">
              <QrCode className="h-28 w-28 sm:h-36 sm:w-36" strokeWidth={1.25} />
              <div className="absolute inset-0 flex items-center justify-center bg-[#004996]/10">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#004996] px-5 py-2.5 text-xs font-black uppercase text-white shadow-lg">
                  <ScanLine className="w-4 h-4" /> Check now
                </span>
              </div>
            </div>
            <p className="m-0 text-center text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Scan the QR code on the package
            </p>
          </div>
        </Link>
      </div>
    </section>
  );
}
