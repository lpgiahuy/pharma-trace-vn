import { HeroSection } from '@/components/home/HeroSection';
import { PromoBanners } from '@/components/home/PromoBanners';
import { CategoryGrid } from '@/components/home/CategoryGrid';
import { FlashSale } from '@/components/home/FlashSale';
import { RecommendedProducts } from '@/components/home/RecommendedProducts';
import { HealthCorner } from '@/components/home/HealthCorner';
import { TraceabilitySection } from '@/components/home/TraceabilitySection';

export const metadata = {
  title: 'PharmaTrace VN — Genuine medicines, traceable by QR',
};

export default function HomePage() {
  return (
    <div className="flex flex-col gap-8">
      <HeroSection />
      <PromoBanners />
      <CategoryGrid />
      <FlashSale />
      <RecommendedProducts />
      <HealthCorner />
      <TraceabilitySection />
    </div>
  );
}
