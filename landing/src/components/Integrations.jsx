import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Plug, ArrowRight, CheckCircle2 } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

export default function Integrations() {
  const sectionRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.integrations-reveal',
        { opacity: 0, y: 40 },
        {
          opacity: 1,
          y: 0,
          duration: 0.7,
          ease: 'power3.out',
          stagger: 0.12,
          scrollTrigger: {
            trigger: sectionRef.current,
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
      id="integrations"
      ref={sectionRef}
      className="bg-navy rounded-[3rem] mx-3 md:mx-6 my-12 overflow-hidden"
    >
      <div className="max-w-6xl mx-auto px-6 md:px-12 py-20">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* Copy */}
          <div>
            <div className="integrations-reveal inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 mb-6">
              <Plug className="w-3.5 h-3.5 text-accent" />
              <span className="text-xs font-mono uppercase tracking-widest text-accent">
                Works With Your DMS
              </span>
            </div>

            <h2 className="integrations-reveal text-3xl md:text-4xl font-bold text-white leading-tight mb-5">
              Keep using the software you already run.
            </h2>

            <p className="integrations-reveal text-white/50 leading-relaxed mb-8">
              Auto Lien Tracker connects to your dealer management system, so every
              new deal flows in automatically — no exports, no spreadsheets, no
              double entry. The moment a deal closes, we ask the borrower for proof
              of insurance and start verifying coverage for you.
            </p>

            <div className="integrations-reveal space-y-3 mb-8">
              <div className="flex items-center gap-3 text-sm text-white/70">
                <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
                New deals sync automatically from your DMS.
              </div>
              <div className="flex items-center gap-3 text-sm text-white/70">
                <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
                Borrowers are asked for proof of insurance instantly.
              </div>
              <div className="flex items-center gap-3 text-sm text-white/70">
                <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
                You see verified coverage without lifting a finger.
              </div>
            </div>

            <p className="integrations-reveal text-sm text-white/40">
              Build a DMS or CRM platform?{' '}
              <a
                href="/partners"
                className="text-accent hover:text-accent/80 inline-flex items-center gap-1 font-medium"
              >
                Partner with us
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </p>
          </div>

          {/* Flow visual */}
          <div className="integrations-reveal">
            <div className="bg-[#0a0e1a] rounded-2xl border border-white/[0.06] p-6 md:p-8 shadow-2xl shadow-black/40">
              <p className="text-[10px] font-mono text-white/30 uppercase tracking-wider mb-6">
                How a deal flows in
              </p>

              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center text-lg shrink-0">
                    🏷️
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Your DMS</p>
                    <p className="text-xs text-white/40">A deal closes</p>
                  </div>
                </div>

                <div className="ml-5 h-5 border-l border-dashed border-white/15" />

                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-lg shrink-0">
                    🔗
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Auto Lien Tracker</p>
                    <p className="text-xs text-white/40">
                      Borrower added · insurance requested
                    </p>
                  </div>
                </div>

                <div className="ml-5 h-5 border-l border-dashed border-white/15" />

                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center text-lg shrink-0">
                    ✓
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Coverage verified</p>
                    <p className="text-xs text-white/40">
                      Monitored for lapses automatically
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
