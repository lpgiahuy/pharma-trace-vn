// Banner images live in /public/images/banners. Drop real images with these file names
// (or change the paths here). A gradient placeholder is shown while a file is missing.
export interface BannerItem {
  src: string;
  alt: string;
  href: string;
  gradient: string;
  title: string;
  subtitle: string;
}

export const HERO_BANNERS: BannerItem[] = [
  {
    src: '/images/banners/hero-1.jpg',
    alt: 'Member week — up to 50% off',
    href: '/products',
    gradient: 'from-[#004996] via-[#0a6bd1] to-[#38aaf7]',
    title: 'Member Week',
    subtitle: 'Up to 50% off health essentials',
  },
  {
    src: '/images/banners/hero-2.jpg',
    alt: 'Genuine medicines with QR traceability',
    href: '/products',
    gradient: 'from-[#00A551] via-[#14b866] to-[#6ee7a8]',
    title: 'Scan. Verify. Trust.',
    subtitle: 'Every product is traceable by QR code',
  },
  {
    src: '/images/banners/hero-3.jpg',
    alt: 'Vitamins & supplements deals',
    href: '/products',
    gradient: 'from-[#f97316] via-[#fb923c] to-[#fdba74]',
    title: 'Vitamins & Supplements',
    subtitle: 'Boost immunity, save more',
  },
];

export const PROMO_BANNERS: BannerItem[] = [
  {
    src: '/images/banners/promo-1.jpg',
    alt: 'Skin care',
    href: '/products',
    gradient: 'from-[#0ea5e9] to-[#7dd3fc]',
    title: 'Skin Care',
    subtitle: 'Sun protection & more',
  },
  {
    src: '/images/banners/promo-2.jpg',
    alt: 'Cold & flu',
    href: '/products',
    gradient: 'from-[#14b8a6] to-[#5eead4]',
    title: 'Cold & Flu Season',
    subtitle: 'Be prepared at home',
  },
  {
    src: '/images/banners/promo-3.jpg',
    alt: 'Medical devices',
    href: '/products',
    gradient: 'from-[#8b5cf6] to-[#c4b5fd]',
    title: 'Health Devices',
    subtitle: 'Monitor your health daily',
  },
  {
    src: '/images/banners/promo-4.jpg',
    alt: 'Free shipping',
    href: '/products',
    gradient: 'from-[#6366f1] to-[#a5b4fc]',
    title: 'Free Delivery',
    subtitle: 'On orders over 500,000 ₫',
  },
];
