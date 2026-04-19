import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  Upload,
  ScanSearch,
  Bell,
  Users,
  FileSpreadsheet,
  ShieldCheck,
  Mail,
  Smartphone,
} from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const capabilities = [
  {
    icon: Upload,
    title: 'Bulk Import',
    description: 'Upload your portfolio from a spreadsheet in one step.',
  },
  {
    icon: ScanSearch,
    title: 'Insurance Card OCR',
    description: 'Borrowers snap a photo; we extract policy details automatically.',
  },
  {
    icon: ShieldCheck,
    title: 'Direct Carrier Checks',
    description: 'Verify coverage with Progressive, State Farm, Allstate, and National General.',
  },
  {
    icon: Bell,
    title: 'Lapse Alerts',
    description: 'Automated weekly scans flag lapses before they become losses.',
  },
  {
    icon: Mail,
    title: 'Email & SMS Outreach',
    description: 'Send borrowers a link to upload proof — no phone calls needed.',
  },
  {
    icon: Smartphone,
    title: 'Borrower Self-Service',
    description: 'Mobile-friendly intake lets borrowers verify from any device.',
  },
  {
    icon: Users,
    title: 'Team Access',
    description: 'Invite your team with role-based permissions and audit trails.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Verification History',
    description: 'Full compliance record for every borrower, exportable anytime.',
  },
];

export default function Philosophy() {
  const sectionRef = useRef(null);
  const cardsRef = useRef([]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      cardsRef.current.forEach((card) => {
        if (!card) return;
        gsap.fromTo(
          card,
          { opacity: 0, y: 40 },
          {
            opacity: 1,
            y: 0,
            duration: 0.6,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: card,
              start: 'top 85%',
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
      ref={sectionRef}
      className="relative py-24 md:py-32 bg-navy overflow-hidden"
    >
      <div className="relative z-10 max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="text-xs font-mono tracking-widest uppercase text-accent/60 mb-4 block">
            What's Included
          </span>
          <h2 className="text-3xl md:text-5xl font-extrabold text-white leading-tight">
            Everything your team needs to
            <br />
            <span className="font-serif italic text-accent">stay compliant.</span>
          </h2>
        </div>

        {/* Capability Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {capabilities.map((cap, i) => (
            <div
              key={cap.title}
              ref={(el) => (cardsRef.current[i] = el)}
              className="opacity-0 bg-white/[0.05] border border-white/[0.08] rounded-2xl p-5 hover:bg-white/[0.08] transition-colors"
            >
              <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center mb-4">
                <cap.icon className="w-5 h-5 text-accent" />
              </div>
              <h3 className="text-sm font-bold text-white mb-1">{cap.title}</h3>
              <p className="text-xs text-white/50 leading-relaxed">{cap.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
