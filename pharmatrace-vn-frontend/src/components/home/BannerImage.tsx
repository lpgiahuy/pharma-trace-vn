'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { cn } from '@/utils';
import type { BannerItem } from './banners';

interface BannerImageProps {
  banner: BannerItem;
  className?: string;
  priority?: boolean;
  /** Render as a plain block (no link), e.g. when used as a background layer. */
  linked?: boolean;
  /** Show the title/subtitle over the gradient placeholder. */
  showPlaceholderText?: boolean;
  /** Also print the title and subtitle over a loaded image (for photos without text). */
  overlayText?: boolean;
}

export function BannerImage({ banner, className, priority, linked = true, showPlaceholderText = true, overlayText = false }: BannerImageProps) {
  const [failed, setFailed] = useState(false);

  const content = !failed ? (
    <>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img
      src={banner.src}
      alt={banner.alt}
      loading={priority ? 'eager' : 'lazy'}
      ref={(el) => {
        // The error may fire before hydration attaches onError, so re-check on mount.
        if (el && el.complete && el.naturalWidth === 0) setFailed(true);
      }}
      onError={() => setFailed(true)}
      className="absolute inset-0 h-full w-full object-cover"
      style={{ objectPosition: banner.position }}
    />
    {overlayText && (
      <>
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/70 via-slate-900/10 to-transparent" />
        <div className="absolute bottom-4 left-5 right-5">
          <p className="m-0 text-lg sm:text-2xl font-extrabold !text-white leading-tight drop-shadow">{banner.title}</p>
          <p className="m-0 mt-0.5 text-xs sm:text-sm !text-white/90 drop-shadow">{banner.subtitle}</p>
        </div>
      </>
    )}
    </>
  ) : (
    <div className={cn('absolute inset-0 bg-gradient-to-br p-5 sm:p-8 flex flex-col justify-center', banner.gradient)}>
      {showPlaceholderText && (
        <>
          <p className="m-0 text-xl sm:text-3xl font-extrabold !text-white leading-tight">{banner.title}</p>
          <p className="m-0 mt-1 text-sm sm:text-base !text-white/90">{banner.subtitle}</p>
        </>
      )}
    </div>
  );

  const cls = cn('relative block overflow-hidden bg-slate-100', className);

  return linked ? (
    <Link href={banner.href} aria-label={banner.alt} className={cls}>
      {content}
    </Link>
  ) : (
    <div className={cls}>{content}</div>
  );
}
