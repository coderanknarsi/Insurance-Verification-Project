import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Plug, ArrowRight, Zap, ShieldCheck } from 'lucide-react';

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
                For DMS & CRM Platforms
              </span>
            </div>

            <h2 className="integrations-reveal text-3xl md:text-4xl font-bold text-white leading-tight mb-5">
              Verification built into the software your dealers already use.
            </h2>

            <p className="integrations-reveal text-white/50 leading-relaxed mb-8">
              Our Deals API lets any dealer management system or CRM push a new deal
              the moment it closes. We auto-create the borrower, request proof of
              insurance, and stream verification status back to your platform — no
              manual uploads, no double entry.
            </p>

            <div className="integrations-reveal space-y-3 mb-8">
              <div className="flex items-center gap-3 text-sm text-white/70">
                <Zap className="w-4 h-4 text-accent shrink-0" />
                One REST call to push a deal — borrower, vehicle, and policy created automatically.
              </div>
              <div className="flex items-center gap-3 text-sm text-white/70">
                <ShieldCheck className="w-4 h-4 text-accent shrink-0" />
                Signed webhooks deliver live verification status back to your system.
              </div>
            </div>

            <a
              href="/integrations"
              className="integrations-reveal btn-magnetic inline-flex items-center gap-2 bg-accent text-white text-sm font-semibold px-6 py-3 rounded-full hover:bg-accent/90 transition-all duration-300"
            >
              Explore the integration
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>

          {/* Code preview */}
          <div className="integrations-reveal">
            <div className="bg-[#0a0e1a] rounded-2xl border border-white/[0.06] overflow-hidden shadow-2xl shadow-black/40">
              <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/[0.06]">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
                <span className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
                <span className="ml-3 text-[10px] font-mono text-white/30 uppercase tracking-wider">
                  POST /v1/deals
                </span>
              </div>
              <pre className="p-5 text-[11px] md:text-xs font-mono leading-relaxed overflow-x-auto">
{`curl https://api.autolientracker.com/v1/deals \\
  -H "Authorization: Bearer alt_live_..." \\
  -d '{
    `}<span className="text-accent">"borrower"</span>{`: { `}<span className="text-green-400">"name"</span>{`: "Jane Doe" },
    `}<span className="text-accent">"vehicle"</span>{`:  { `}<span className="text-green-400">"vin"</span>{`: "1HGCM82633A..." },
    `}<span className="text-accent">"loanNumber"</span>{`: "DLR-90412"
  }'

`}<span className="text-white/30">{`# → 201 Created`}</span>{`
{ `}<span className="text-accent">"policyId"</span>{`: "shtVTZ...", `}<span className="text-accent">"intakeRequested"</span>{`: true }`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
