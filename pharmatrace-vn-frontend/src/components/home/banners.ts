// Banner images live in /public/images/banners. Drop real images with these file names
// (or change the paths here). A gradient placeholder is shown while a file is missing.
export interface BannerItem {
  src: string;
  alt: string;
  href: string;
  gradient: string;
  title: string;
  subtitle: string;
  /** Which part of the image stays visible when it is cropped, e.g. 'center top' or '50% 20%'. Default: center. */
  position?: string;
}

export const HERO_BANNERS: BannerItem[] = [
  {
    src: 'https://blog-assets.futuredoctor.group/blogs/6a59f4adc5993a832e74e75c/74910ce4-2ba4-4634-91b6-a1645e463101-shutterstock-2505610267-scaled.jpg',
    alt: 'Member week — up to 50% off',
    href: '/products',
    gradient: 'from-[#004996] via-[#0a6bd1] to-[#38aaf7]',
    title: 'Member Week',
    subtitle: 'Up to 50% off health essentials',
  },
  {
    src: 'https://cdn.prod.website-files.com/66bd394eedeb9d6ee29898c6/682f5450a046c241920c1e6f_Three%20doctors%20standing%20side%20by%20side%2C%20crossing%20their%20arms.jpg',
    alt: 'Genuine medicines with QR traceability',
    href: '/products',
    gradient: 'from-[#00A551] via-[#14b866] to-[#6ee7a8]',
    title: 'Scan. Verify. Trust.',
    subtitle: 'Every product is traceable by QR code',
    position: 'center 20%'
  },
  {
    src: 'https://www.newscientist.com/wp-content/uploads/2019/06/18153152/medicineshutterstock_1421041688.jpg?w=840',
    alt: 'Vitamins & supplements deals',
    href: '/products',
    gradient: 'from-[#f97316] via-[#fb923c] to-[#fdba74]',
    title: 'Vitamins & Supplements',
    subtitle: 'Boost immunity, save more',
  },
];

export const PROMO_BANNERS: BannerItem[] = [
  {
    src: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTou8JBFO4txIOl4rA351wKQl0CcY708GA17QK_PrvkRQ&s=10',
    alt: 'Skin care',
    href: '/products',
    gradient: 'from-[#0ea5e9] to-[#7dd3fc]',
    title: 'Skin Care',
    subtitle: 'Sun protection & more',
    position: 'center 70%'
  },
  {
    src: 'https://elements-resized.envatousercontent.com/elements-cover-images/6165628f-217d-4e9d-84a9-20c295476dc6?w=433&cf_fit=scale-down&q=85&format=auto&s=1494ef297e4740b67a0a6bd33e6cd46f0c465a5a8ce887c69151c9cddab64408',
    alt: 'Cold & flu',
    href: '/products',
    gradient: 'from-[#14b8a6] to-[#5eead4]',
    title: 'Cold & Flu Season',
    subtitle: 'Be prepared at home',
  },
  {
    src: 'https://cdn.nhathuoclongchau.com.vn/unsafe/800x0/nen_do_huyet_ap_vao_buoi_sang_hay_buoi_toi_de_co_ket_qua_chinh_xac_4_0baef0a541.jpg',
    alt: 'Medical devices',
    href: '/products',
    gradient: 'from-[#8b5cf6] to-[#c4b5fd]',
    title: 'Health Devices',
    subtitle: 'Monitor your health daily',
  },
  {
    src: 'https://img.magnific.com/premium-photo/fast-free-shipping-promotional-banner-template_1090356-15484.jpg',
    alt: 'Free shipping',
    href: '/products',
    gradient: 'from-[#6366f1] to-[#a5b4fc]',
    title: 'Free Delivery',
    subtitle: 'On orders over 500,000 ₫',
  },
];
