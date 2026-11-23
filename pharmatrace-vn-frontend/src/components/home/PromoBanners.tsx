'use client';

import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/utils';
import { BannerImage } from './BannerImage';
import { PROMO_BANNERS } from './banners';

const PER_SLIDE = 2;

export function PromoBanners() {
  const slideCount = Math.ceil(PROMO_BANNERS.length / PER_SLIDE);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setSlide((s) => (s + 1) % slideCount), 6000);
    return () => clearInterval(t);
  }, [slideCount]);

  const go = (n: number) => setSlide((n + slideCount) % slideCount);

  return (
    <section>
      <div className="relative overflow-hidden rounded-2xl group">
        <div className="flex transition-transform duration-500 ease-in-out" style={{ transform: `translateX(-${slide * 100}%)` }}>
          {Array.from({ length: slideCount }).map((_, si) => (
            <div key={si} className="w-full shrink-0 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PROMO_BANNERS.slice(si * PER_SLIDE, si * PER_SLIDE + PER_SLIDE).map((b) => (
                <BannerImage key={b.src} banner={b} className="h-40 sm:h-52 rounded-xl" />
              ))}
            </div>
          ))}
        </div>
        {slideCount > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous promotions"
              onClick={() => go(slide - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white/90 shadow-md flex items-center justify-center cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5 text-slate-700" />
            </button>
            <button
              type="button"
              aria-label="Next promotions"
              onClick={() => go(slide + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white/90 shadow-md flex items-center justify-center cursor-pointer"
            >
              <ChevronRight className="w-5 h-5 text-slate-700" />
            </button>
          </>
        )}
      </div>
      {slideCount > 1 && (
        <div className="flex justify-center gap-2 mt-3">
          {Array.from({ length: slideCount }).map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Promotion slide ${i + 1}`}
              onClick={() => setSlide(i)}
              className={cn('h-2 rounded-full transition-all cursor-pointer', i === slide ? 'w-5 bg-[#004996]' : 'w-2 bg-slate-300 hover:bg-slate-400')}
            />
          ))}
        </div>
      )}
    </section>
  );
}
