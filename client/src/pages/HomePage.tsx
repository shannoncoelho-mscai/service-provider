import FeaturedProviders from '../components/home/FeaturedProviders';
import Hero from '../components/home/Hero';
import HowItWorks from '../components/home/HowItWorks';
import PopularServices from '../components/home/PopularServices';
import ProviderCta from '../components/home/ProviderCta';
import WhyServiceConnect from '../components/home/WhyServiceConnect';

/**
 * Customer-facing home page.
 *
 * Composed entirely from section components in components/home/ so the page
 * stays readable and each section can evolve independently. Full-bleed
 * sections own their own `.shell` container; App.tsx deliberately adds no
 * width constraint so marketing sections can span the viewport.
 *
 * Section order follows the brief: hero → popular services → how it works →
 * featured providers → why ServiceConnect → provider CTA.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <PopularServices />
      <HowItWorks />
      <FeaturedProviders />
      <WhyServiceConnect />
      <ProviderCta />
    </>
  );
}
