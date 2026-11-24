'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Search, FileText, Stethoscope, MapPin } from 'lucide-react';
import { cn } from '@/utils';
import { BannerImage } from './BannerImage';
import { HERO_BANNERS } from './banners';

const SUGGESTIONS = ['face mask', 'nutritional milk', 'eye drops', 'omega 3', 'sunscreen spray', 'probiotics'];

const QUICK_LINKS = [
  { label: 'Upload prescription', icon: FileText, href: '/account/prescriptions' },
  { label: 'Ask a pharmacist', icon: Stethoscope, href: '/blog' },
  { label: 'Find a pharmacy', icon: MapPin, href: '/products' },
];

export function HeroSection() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [query, setQuery] = useState('');
  const count = HERO_BANNERS.length;

  useEffect(() => {
    const t = setInterval(() => setIndex((i) => (i + 1) % count), 5000);
    return () => clearInterval(t);
  }, [count]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) router.push(`/products?search=${encodeURIComponent(query.trim())}`);
  };

  return (
    <section className="relative overflow-hidden rounded-2xl min-h-[360px] sm:min-h-[430px]">
      {HERO_BANNERS.map((b, i) => (
        <div
          key={b.src}
          className={cn('absolute inset-0 transition-opacity duration-1000', i === index ? 'opacity-100' : 'opacity-0')}
        >
          <BannerImage banner={b} linked={false} priority={i === 0} showPlaceholderText={false} className="h-full w-full" />
        </div>
      ))}
      <div className="absolute inset-0 bg-[#001e3e]/40" />

      <button
        type="button"
        aria-label="Next background"
        onClick={() => setIndex((i) => (i + 1) % count)}
        className="absolute right-4 top-1/2 -translate-y-1/2 z-20 h-10 w-10 rounded-full bg-white/80 hover:bg-white shadow-md flex items-center justify-center cursor-pointer"
      >
        <ChevronRight className="w-5 h-5 text-slate-700" />
      </button>

      <div className="absolute inset-0 z-10 flex items-end justify-center px-4 pb-14 pointer-events-none">
        <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden pointer-events-auto">
          <div className="px-4 pt-4 pb-3">
            <form onSubmit={onSearch}>
              <div className="relative flex items-center h-12 rounded-full border border-slate-200 focus-within:border-[#38aaf7] focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                <Search className="absolute left-4 w-5 h-5 text-slate-400 pointer-events-none" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search medicines, vitamins, supplements..."
                  className="flex-1 h-full pl-12 pr-4 rounded-full bg-transparent focus:outline-none text-[15px] font-medium text-slate-800 placeholder:text-slate-400"
                />
              </div>
            </form>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">
              {SUGGESTIONS.map((kw) => (
                <Link
                  key={kw}
                  href={`/products?search=${encodeURIComponent(kw)}`}
                  className="text-[13px] !text-[#004996] hover:underline"
                >
                  {kw}
                </Link>
              ))}
            </div>
          </div>
          <div className="border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 sm:divide-x divide-slate-100">
            {QUICK_LINKS.map(({ label, icon: Icon, href }) => (
              <Link key={label} href={href} className="group flex items-center gap-2.5 px-4 py-3 hover:bg-slate-50 transition-colors">
                <span className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-[#004996]" />
                </span>
                <span className="flex-1 text-[13px] font-bold !text-slate-700 group-hover:!text-[#004996] leading-tight">{label}</span>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 z-10">
        {HERO_BANNERS.map((b, i) => (
          <button
            key={b.src}
            type="button"
            aria-label={`Show background ${i + 1}`}
            onClick={() => setIndex(i)}
            className={cn('h-2 rounded-full transition-all cursor-pointer', i === index ? 'w-5 bg-white' : 'w-2 bg-white/40 hover:bg-white/60')}
          />
        ))}
      </div>
    </section>
  );
}
