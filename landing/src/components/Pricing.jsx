import { useState, useMemo, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Check, Calculator } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const DASHBOARD_BASE = import.meta.env.VITE_DASHBOARD_URL || 'https://app.autolientracker.com';
const SIGNUP_URL = `${DASHBOARD_BASE}?mode=signup`;

const tiers = [
  { min: 0, max: 100, perVehicle: 3.49, label: 'Starter' },
  { min: 101, max: 500, perVehicle: 2.99, label: 'Growth' },
  { min: 501, max: 1000, perVehicle: 2.49, label: 'Scale' },
  { min: 1001, max: Infinity, perVehicle: 1.99, label: 'Enterprise' },
];

const included = [
  'Real-time insurance monitoring',
  'Automated lapse detection & alerts',
  'Borrower self-service verification links',
  'Dashboard with portfolio risk overview',
  'API access & webhook integrations',
  'Dedicated onboarding specialist',
];

function getTier(count) {
  return tiers.find((t) => count >= t.min && count <= t.max) || tiers[tiers.length - 1];
}

export default function Pricing() {
  const [vehicleCount, setVehicleCount] = useState(250);
  const sectionRef = useRef(null);
  const contentRef = useRef(null);

  const tier = useMemo(() => getTier(vehicleCount), [vehicleCount]);
  const baseFee = 149;
  const monthlyTotal = baseFee + vehicleCount * tier.perVehicle;
  const avgLoanValue = 12000;
  const portfolioValue = vehicleCount * avgLoanValue;

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, y: 60 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: contentRef.current,
            start: 'top 80%',
            once: true,
          },
        }
      );
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      id="pricing"
      ref={sectionRef}
      className="py-24 md:py-32 bg-navy"
    >
      <div className="max-w-4xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="text-xs font-mono tracking-widest uppercase text-accent/60 mb-4 block">
            Pricing
          </span>
          <h2 className="text-3xl md:text-5xl font-extrabold text-white leading-tight">
            Simple, volume-based
            <br />
            <span className="font-serif italic text-accent">pricing.</span>
          </h2>
          <p className="text-white/50 mt-4 max-w-lg mx-auto">
            One plan. No hidden fees. Scale as your portfolio grows.
          </p>
        </div>

        {/* Calculator Card */}
        <div ref={contentRef} className="opacity-0">
          <div className="bg-white/[0.05] backdrop-blur-sm border border-white/10 rounded-3xl p-8 md:p-12">
            {/* Slider */}
            <div className="mb-10">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm text-white/60 font-medium flex items-center gap-2">
                  <Calculator className="w-4 h-4" />
                  Vehicles in portfolio
                </label>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-white font-mono">
                    {vehicleCount.toLocaleString()}
                  </span>
                  {vehicleCount >= 1000 && (
                    <span className="text-xs text-accent font-mono">+</span>
                  )}
                </div>
              </div>

              <input
                type="range"
                min="10"
                max="1000"
                step="10"
                value={Math.min(vehicleCount, 1000)}
                onChange={(e) => setVehicleCount(Number(e.target.value))}
                className="w-full h-2 bg-white/10 rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:w-5
                  [&::-webkit-slider-thumb]:h-5
                  [&::-webkit-slider-thumb]:bg-accent
                  [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:shadow-lg
                  [&::-webkit-slider-thumb]:shadow-accent/30
                  [&::-webkit-slider-thumb]:cursor-pointer
                  [&::-moz-range-thumb]:w-5
                  [&::-moz-range-thumb]:h-5
                  [&::-moz-range-thumb]:bg-accent
                  [&::-moz-range-thumb]:rounded-full
                  [&::-moz-range-thumb]:border-0
                  [&::-moz-range-thumb]:cursor-pointer"
              />

              {/* Tier Labels */}
              <div className="flex justify-between mt-2">
                {tiers.map((t) => (
                  <span
                    key={t.label}
                    className={`text-[10px] font-mono transition-colors duration-200 ${
                      tier.label === t.label
                        ? 'text-accent font-semibold'
                        : 'text-white/20'
                    }`}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Pricing Breakdown */}
            <div className="grid md:grid-cols-2 gap-8 mb-10">
              {/* Cost */}
              <div className="bg-white/[0.03] rounded-2xl p-6 border border-white/[0.06]">
                <p className="text-xs text-white/40 font-mono uppercase tracking-wider mb-2">
                  Monthly Cost
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl md:text-5xl font-extrabold text-white">
                    ${monthlyTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                  <span className="text-white/40 text-sm">/mo</span>
                </div>
                <div className="mt-3 space-y-1 text-xs text-white/40 font-mono">
                  <p>Base platform: ${baseFee}/mo</p>
                  <p>
                    Per vehicle: ${tier.perVehicle}/mo × {vehicleCount.toLocaleString()} = $
                    {(vehicleCount * tier.perVehicle).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                </div>
              </div>

              {/* Portfolio Value */}
              <div className="bg-accent/[0.08] rounded-2xl p-6 border border-accent/20">
                <p className="text-xs text-accent/60 font-mono uppercase tracking-wider mb-2">
                  Portfolio Protected
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl md:text-5xl font-extrabold text-accent">
                    ${(portfolioValue / 1000000).toFixed(1)}M
                  </span>
                </div>
                <p className="mt-3 text-xs text-accent/50 font-mono">
                  Based on avg. loan value of ${avgLoanValue.toLocaleString()}
                </p>
              </div>
            </div>

            {/* Included Features */}
            <div className="border-t border-white/[0.06] pt-8">
              <p className="text-xs text-white/40 font-mono uppercase tracking-wider mb-4">
                Everything Included
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {included.map((feature) => (
                  <div key={feature} className="flex items-center gap-3">
                    <div className="w-5 h-5 bg-accent/10 rounded-full flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-accent" />
                    </div>
                    <span className="text-sm text-white/70">{feature}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div className="mt-10 text-center">
              <a
                href={SIGNUP_URL}
                className="btn-magnetic inline-block relative bg-accent text-white font-semibold text-lg px-10 py-4 rounded-full shadow-lg shadow-accent/30 hover:shadow-xl hover:shadow-accent/40 transition-shadow"
              >
                <span className="btn-bg bg-white/20 rounded-full" />
                <span className="relative z-10">Start Free Pilot</span>
              </a>
              <p className="text-xs text-white/30 mt-4">
                14-day free trial · No credit card required · Cancel anytime
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
