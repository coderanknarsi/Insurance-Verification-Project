import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Shield, Scan, Activity } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const steps = [
  {
    number: '01',
    icon: Scan,
    title: 'Connect & Ingest',
    description:
      'Import your loan portfolio or connect via API. Auto Lien Tracker maps each borrower to their vehicle and active policy.',
    visual: 'geometric',
    accent: '#2563EB',
  },
  {
    number: '02',
    icon: Shield,
    title: 'Verify & Monitor',
    description:
      'Our system contacts insurance carriers, verifies active coverage, and confirms your dealership is listed as lienholder — continuously.',
    visual: 'scanner',
    accent: '#22C55E',
  },
  {
    number: '03',
    icon: Activity,
    title: 'Alert & Protect',
    description:
      'The moment a policy lapses or a gap is detected, you get an alert. Take action before a loss event — not after.',
    visual: 'waveform',
    accent: '#EF4444',
  },
];

/* ─── Animated Visuals ───────────────────────────── */
function GeometricVisual() {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <div className="relative w-32 h-32">
        <div
          className="absolute inset-0 border-2 border-accent/30 rounded-xl"
          style={{ animation: 'rotate-slow 12s linear infinite' }}
        />
        <div
          className="absolute inset-3 border-2 border-accent/50 rounded-lg"
          style={{ animation: 'rotate-slow 8s linear infinite reverse' }}
        />
        <div
          className="absolute inset-6 border-2 border-accent rounded-md"
          style={{ animation: 'rotate-slow 6s linear infinite' }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <Scan className="w-8 h-8 text-accent" />
        </div>
      </div>
    </div>
  );
}

function ScannerVisual() {
  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
      <div className="relative w-40 h-32 border border-green-500/30 rounded-lg overflow-hidden">
        {/* Scan line */}
        <div
          className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-green-400 to-transparent"
          style={{ animation: 'scan-line 3s ease-in-out infinite' }}
        />
        {/* Grid lines */}
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 border-t border-green-500/10"
            style={{ top: `${(i + 1) * 25}%` }}
          />
        ))}
        {/* Data points */}
        <div className="absolute top-1/3 left-1/4 w-2 h-2 bg-green-400 rounded-full pulse-dot" />
        <div className="absolute top-1/2 left-2/3 w-2 h-2 bg-green-400 rounded-full pulse-dot" style={{ animationDelay: '0.5s' }} />
        <div className="absolute top-2/3 left-1/3 w-2 h-2 bg-yellow-400 rounded-full pulse-dot" style={{ animationDelay: '1s' }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <Shield className="w-8 h-8 text-green-500/30" />
        </div>
      </div>
    </div>
  );
}

function WaveformVisual() {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg viewBox="0 0 200 80" className="w-48 h-20" fill="none">
        <path
          d="M0 40 Q25 10 50 40 T100 40 T150 40 T200 40"
          stroke="#EF4444"
          strokeWidth="2"
          strokeDasharray="300"
          strokeDashoffset="300"
          style={{ animation: 'dash-offset 3s ease-in-out infinite alternate' }}
          opacity="0.6"
        />
        <path
          d="M0 40 Q25 20 50 40 T100 40 T150 40 T200 40"
          stroke="#EF4444"
          strokeWidth="1.5"
          strokeDasharray="300"
          strokeDashoffset="300"
          style={{ animation: 'dash-offset 2.5s ease-in-out infinite alternate' }}
          opacity="0.3"
        />
        {/* Alert pulse */}
        <circle cx="100" cy="40" r="4" fill="#EF4444" className="pulse-dot" />
        <circle cx="100" cy="40" r="8" fill="none" stroke="#EF4444" strokeWidth="1" className="pulse-dot" opacity="0.4" />
      </svg>
    </div>
  );
}

const visuals = {
  geometric: GeometricVisual,
  scanner: ScannerVisual,
  waveform: WaveformVisual,
};

export default function Protocol() {
  const sectionRef = useRef(null);
  const cardsRef = useRef([]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      cardsRef.current.forEach((card, i) => {
        if (!card) return;
        gsap.fromTo(
          card,
          { opacity: 0, y: 80 },
          {
            opacity: 1,
            y: 0,
            duration: 0.8,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: card,
              start: 'top 80%',
              once: true,
            },
          }
        );
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      id="protocol"
      ref={sectionRef}
      className="py-24 md:py-32 bg-offwhite"
    >
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-20">
          <span className="text-xs font-mono tracking-widest uppercase text-accent mb-4 block">
            How It Works
          </span>
          <h2 className="text-3xl md:text-5xl font-extrabold text-navy leading-tight">
            Three steps to
            <br />
            <span className="font-serif italic text-accent">total coverage.</span>
          </h2>
        </div>

        {/* Protocol Steps */}
        <div className="space-y-16 md:space-y-24">
          {steps.map((step, i) => {
            const Visual = visuals[step.visual];
            const isEven = i % 2 === 0;
            return (
              <div
                key={step.number}
                ref={(el) => (cardsRef.current[i] = el)}
                className={`opacity-0 flex flex-col ${
                  isEven ? 'md:flex-row' : 'md:flex-row-reverse'
                } items-center gap-8 md:gap-16`}
              >
                {/* Visual */}
                <div className="flex-1 w-full">
                  <div
                    className="bg-navy/[0.03] border border-navy/[0.06] rounded-3xl h-64 md:h-72 flex items-center justify-center"
                  >
                    <Visual />
                  </div>
                </div>

                {/* Text */}
                <div className="flex-1 w-full">
                  <div className="flex items-center gap-4 mb-4">
                    <span
                      className="text-5xl md:text-7xl font-extrabold leading-none"
                      style={{ color: step.accent, opacity: 0.15 }}
                    >
                      {step.number}
                    </span>
                    <div
                      className="w-12 h-12 rounded-2xl flex items-center justify-center"
                      style={{ backgroundColor: `${step.accent}15` }}
                    >
                      <step.icon
                        className="w-6 h-6"
                        style={{ color: step.accent }}
                      />
                    </div>
                  </div>
                  <h3 className="text-2xl md:text-3xl font-bold text-navy mb-4">
                    {step.title}
                  </h3>
                  <p className="text-base md:text-lg text-carbon/70 leading-relaxed max-w-md">
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
