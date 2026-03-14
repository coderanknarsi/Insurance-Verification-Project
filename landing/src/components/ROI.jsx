import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { DollarSign, ShieldAlert, TrendingUp } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

export default function ROI() {
  const sectionRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        cardRef.current,
        { opacity: 0, y: 60 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: cardRef.current,
            start: 'top 80%',
            once: true,
          },
        }
      );
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="py-20 md:py-28 bg-navy">
      <div className="max-w-5xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-14">
          <span className="text-xs font-mono tracking-widest uppercase text-accent/60 mb-4 block">
            The Math
          </span>
          <h2 className="text-3xl md:text-5xl font-extrabold text-white leading-tight">
            One caught lapse pays for
            <br />
            <span className="font-serif italic text-accent">an entire year.</span>
          </h2>
        </div>

        {/* Comparison Card */}
        <div ref={cardRef} className="opacity-0">
          <div className="grid md:grid-cols-2 gap-6 md:gap-0">
            {/* Cost of Doing Nothing */}
            <div className="bg-red-500/[0.08] border border-red-500/20 rounded-3xl md:rounded-r-none p-8 md:p-10">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-red-500/20 rounded-xl flex items-center justify-center">
                  <ShieldAlert className="w-5 h-5 text-red-400" />
                </div>
                <h3 className="text-lg font-bold text-red-400">Without Auto Lien Tracker</h3>
              </div>

              <div className="space-y-5">
                <div>
                  <p className="text-xs text-white/40 font-mono uppercase tracking-wider mb-1">
                    One totaled, uninsured vehicle
                  </p>
                  <p className="text-4xl md:text-5xl font-extrabold text-red-400">
                    $15,000
                    <span className="text-lg text-red-400/50 ml-1">loss</span>
                  </p>
                </div>

                <div className="border-t border-red-500/10 pt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-white/40">Average BHPH loan value</span>
                    <span className="text-white/60 font-mono">$12,000–$18,000</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/40">Recovery from uninsured borrower</span>
                    <span className="text-red-400 font-mono">~$0</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/40">Time to discover lapse (manual)</span>
                    <span className="text-white/60 font-mono">30–90 days</span>
                  </div>
                </div>
              </div>
            </div>

            {/* With Auto Lien Tracker */}
            <div className="bg-accent/[0.08] border border-accent/20 rounded-3xl md:rounded-l-none p-8 md:p-10">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-accent/20 rounded-xl flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-accent" />
                </div>
                <h3 className="text-lg font-bold text-accent">With Auto Lien Tracker</h3>
              </div>

              <div className="space-y-5">
                <div>
                  <p className="text-xs text-white/40 font-mono uppercase tracking-wider mb-1">
                    Growth plan — up to 150 vehicles
                  </p>
                  <p className="text-4xl md:text-5xl font-extrabold text-accent">
                    $4,188
                    <span className="text-lg text-accent/50 ml-1">/year</span>
                  </p>
                </div>

                <div className="border-t border-accent/10 pt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-white/40">Flat monthly rate</span>
                    <span className="text-white/60 font-mono">$349/mo × 12</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/40">Per-vehicle fees</span>
                    <span className="text-accent font-mono">$0</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/40">Lapse detection speed</span>
                    <span className="text-accent font-mono">Real-time</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Takeaway */}
          <div className="mt-8 text-center bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-center gap-4">
            <DollarSign className="w-8 h-8 text-green-400 flex-shrink-0" />
            <p className="text-white/70 text-base md:text-lg">
              Catching <span className="text-white font-semibold">just one</span> lapsed policy before a total loss{' '}
              <span className="text-green-400 font-semibold">saves more than 3× your annual cost.</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
