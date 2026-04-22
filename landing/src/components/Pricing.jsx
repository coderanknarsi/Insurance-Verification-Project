import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Check } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const DASHBOARD_BASE = import.meta.env.VITE_DASHBOARD_URL || 'https://app.autolientracker.com';
const SIGNUP_URL = `${DASHBOARD_BASE}?mode=signup`;

const SHARED_FEATURES = [
  'Automated carrier verification',
  'Borrower intake via email & SMS',
  'Automatic insurance card scanning',
  'Compliance dashboard & history',
  'Lapse detection & alerts',
  'Team access with role permissions',
  'Bulk portfolio import',
  'Demo environment included',
];

const plans = [
  {
    name: 'Starter',
    price: 149,
    vehicles: 50,
    features: ['Up to 50 vehicles', ...SHARED_FEATURES],
  },
  {
    name: 'Growth',
    price: 349,
    vehicles: 150,
    popular: true,
    features: ['Up to 150 vehicles', ...SHARED_FEATURES],
  },
  {
    name: 'Scale',
    price: 599,
    vehicles: 300,
    features: ['Up to 300 vehicles', ...SHARED_FEATURES],
  },
];

export default function Pricing() {
  const sectionRef = useRef(null);
  const cardsRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        cardsRef.current?.children ?? [],
        { opacity: 0, y: 50 },
        {
          opacity: 1,
          y: 0,
          duration: 0.7,
          ease: 'power3.out',
          stagger: 0.12,
          scrollTrigger: {
            trigger: cardsRef.current,
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
      <div className="max-w-5xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="text-xs font-mono tracking-widest uppercase text-accent/60 mb-4 block">
            Pricing
          </span>
          <h2 className="text-3xl md:text-5xl font-extrabold text-white leading-tight">
            Simple, flat-rate
            <br />
            <span className="font-serif italic text-accent">pricing.</span>
          </h2>
          <p className="text-white/50 mt-4 max-w-lg mx-auto">
            No per-vehicle fees. No hidden charges. Pick the plan that fits your portfolio.
          </p>
        </div>

        {/* Plan Cards */}
        <div ref={cardsRef} className="grid md:grid-cols-3 gap-6 mb-10">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative bg-white/[0.05] backdrop-blur-sm border rounded-3xl p-8 flex flex-col ${
                plan.popular
                  ? 'border-accent/40 ring-1 ring-accent/20'
                  : 'border-white/10'
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-white text-[11px] font-semibold px-4 py-1 rounded-full">
                  Most Popular
                </span>
              )}

              <h3 className="text-lg font-bold text-white">{plan.name}</h3>
              <p className="text-xs text-white/40 mt-1">Up to {plan.vehicles} vehicles</p>

              <div className="mt-5 mb-6">
                <span className="text-4xl font-extrabold text-white">${plan.price}</span>
                <span className="text-white/40 text-sm">/mo</span>
              </div>

              <ul className="space-y-3 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-3">
                    <div className="w-5 h-5 bg-accent/10 rounded-full flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-accent" />
                    </div>
                    <span className="text-sm text-white/70">{f}</span>
                  </li>
                ))}
              </ul>

              <a
                href={SIGNUP_URL}
                className={`mt-8 block text-center font-semibold text-sm py-3 rounded-full transition-all ${
                  plan.popular
                    ? 'bg-accent text-white shadow-lg shadow-accent/30 hover:shadow-xl hover:shadow-accent/40'
                    : 'bg-white/[0.08] text-white hover:bg-white/[0.12]'
                }`}
              >
                Get Started Free
              </a>
            </div>
          ))}
        </div>

        {/* Enterprise */}
        <div className="bg-white/[0.05] backdrop-blur-sm border border-white/10 rounded-3xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <h3 className="text-lg font-bold text-white">Enterprise</h3>
            <p className="text-sm text-white/50 mt-1">
              300+ vehicles &middot; Custom pricing &middot; Dedicated onboarding &middot; SLA guarantees
            </p>
          </div>
          <a
            href="#contact"
            className="whitespace-nowrap bg-white/[0.08] text-white font-semibold text-sm px-8 py-3 rounded-full hover:bg-white/[0.12] transition-colors"
          >
            Contact Sales
          </a>
        </div>

        <p className="text-center text-xs text-white/30 mt-8">
          14-day free trial · No credit card required · Cancel anytime
        </p>
      </div>
    </section>
  );
}
