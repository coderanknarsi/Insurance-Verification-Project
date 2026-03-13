import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ArrowDown } from 'lucide-react';

const DASHBOARD_BASE = import.meta.env.VITE_DASHBOARD_URL || 'https://app.autolientracker.com';
const SIGNUP_URL = `${DASHBOARD_BASE}?mode=signup`;

export default function Hero() {
  const sectionRef = useRef(null);
  const headlineRef = useRef(null);
  const subRef = useRef(null);
  const ctaRef = useRef(null);
  const badgeRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      tl.fromTo(
        badgeRef.current,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.6 }
      )
        .fromTo(
          headlineRef.current.children,
          { opacity: 0, y: 40 },
          { opacity: 1, y: 0, duration: 0.8, stagger: 0.15 },
          '-=0.3'
        )
        .fromTo(
          subRef.current,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.6 },
          '-=0.3'
        )
        .fromTo(
          ctaRef.current,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.5 },
          '-=0.2'
        )
        .fromTo(
          scrollRef.current,
          { opacity: 0 },
          { opacity: 1, duration: 0.8 },
          '-=0.1'
        );

      // Floating scroll indicator
      gsap.to(scrollRef.current, {
        y: 8,
        duration: 1.5,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative min-h-[100dvh] flex items-center justify-center overflow-hidden"
    >
      {/* Background — Dashboard Screenshot */}
      <div
        className="absolute inset-0 bg-cover bg-top bg-no-repeat scale-110"
        style={{
          backgroundImage: 'url(/dashboard-bg.png)',
          filter: 'blur(1.5px) brightness(0.45)',
        }}
      />

      {/* Radial vignette — darkens edges, keeps center subtly visible */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(11,17,32,0.45) 0%, rgba(11,17,32,0.75) 50%, rgba(11,17,32,0.95) 100%)',
        }}
      />

      {/* Top fade band — ensures nav area is dark */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-navy via-navy/80 to-transparent" />

      {/* Bottom fade band — clean transition to next section */}
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-navy via-navy/90 to-transparent" />

      {/* Content */}
      <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
        {/* Status Badge */}
        <div ref={badgeRef} className="opacity-0 mb-8">
          <span className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 text-white/90 text-xs font-mono tracking-wider uppercase px-4 py-2 rounded-full">
            <span className="w-2 h-2 bg-green-400 rounded-full pulse-dot" />
            Insurance Verification Platform
          </span>
        </div>

        {/* Headline */}
        <div ref={headlineRef} className="mb-8">
          <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-extrabold text-white leading-[0.95] tracking-tight">
            Stop Losing Money on
          </h1>
          <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-serif italic text-accent leading-[1.1] mt-2">
            Uninsured Collateral.
          </h1>
        </div>

        {/* Subheadline */}
        <p
          ref={subRef}
          className="opacity-0 text-lg md:text-xl text-white/70 max-w-2xl mx-auto mb-10 leading-relaxed"
        >
          Automated insurance tracking for BHPH dealers, banks, and credit
          unions. Verify borrower coverage in real time, detect lapses before
          they cost you, and keep every vehicle protected — automatically.
        </p>

        {/* CTA */}
        <div ref={ctaRef} className="opacity-0 flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href={SIGNUP_URL}
            className="btn-magnetic relative bg-accent text-white font-semibold text-lg px-8 py-4 rounded-full shadow-lg shadow-accent/30 hover:shadow-xl hover:shadow-accent/40 transition-shadow"
          >
            <span className="btn-bg bg-white/20 rounded-full" />
            <span className="relative z-10">Start Free Pilot</span>
          </a>
          <a
            href="#features"
            className="text-white/60 hover:text-white font-medium text-sm flex items-center gap-2 transition-colors"
          >
            See how it works
            <ArrowDown className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Scroll Indicator */}
      <div
        ref={scrollRef}
        className="opacity-0 absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <div className="w-6 h-10 border-2 border-white/30 rounded-full flex justify-center pt-2">
          <div className="w-1 h-2 bg-white/60 rounded-full" />
        </div>
      </div>
    </section>
  );
}
