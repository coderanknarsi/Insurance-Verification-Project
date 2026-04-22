import Navbar from './components/Navbar';
import Hero from './components/Hero';
import Features from './components/Features';
import ROI from './components/ROI';
import Philosophy from './components/Philosophy';
import Protocol from './components/Protocol';
import Pricing from './components/Pricing';
import Contact from './components/Contact';
import Footer from './components/Footer';
import PrivacyPolicy from './components/PrivacyPolicy';
import TermsConditions from './components/TermsConditions';

export default function App() {
  const path = window.location.pathname;

  if (path === '/privacy') return <PrivacyPolicy />;
  if (path === '/terms') return <TermsConditions />;

  return (
    <>
      <Navbar />
      <Hero />
      <Features />
      <Philosophy />
      <Protocol />
      <ROI />
      <Pricing />
      <Contact />
      <Footer />
    </>
  );
}
