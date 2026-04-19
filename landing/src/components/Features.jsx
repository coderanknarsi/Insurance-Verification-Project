import { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Camera, ShieldCheck, Users, MousePointerClick } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

/* ─── Feature 1: Borrower Intake Demo ─────────────── */
function IntakeDemo() {
  const [step, setStep] = useState(0);
  const steps = [
    { label: 'SMS sent to borrower', icon: '📱', color: 'text-accent' },
    { label: 'Borrower uploads insurance card', icon: '📷', color: 'text-green-400' },
    { label: 'OCR extracts policy details', icon: '🔍', color: 'text-yellow-400' },
    { label: 'Coverage verified automatically', icon: '✓', color: 'text-green-400' },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((s) => (s + 1) % steps.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 h-48 overflow-hidden flex flex-col justify-between">
      <p className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">Borrower Intake Flow</p>
      <div className="flex-1 flex flex-col justify-center space-y-2">
        {steps.map((s, i) => (
          <div
            key={s.label}
            className={`flex items-center gap-2 text-xs p-2 rounded-lg transition-all duration-500 ${
              i <= step
                ? 'bg-accent/5 border border-accent/10'
                : 'opacity-30'
            }`}
          >
            <span className={`text-sm ${i <= step ? s.color : 'text-gray-300'}`}>{s.icon}</span>
            <span className={i <= step ? 'text-navy font-medium' : 'text-gray-400'}>{s.label}</span>
            {i < step && <span className="ml-auto text-green-500 text-xs">✓</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Feature 2: Carrier Verification Status ────────────── */
function VerificationStatus() {
  const [activeIndex, setActiveIndex] = useState(0);
  const carriers = [
    { name: 'Progressive', status: 'Verified', color: 'bg-green-500', policy: 'AUTO-2847-X' },
    { name: 'State Farm', status: 'Lapsed', color: 'bg-red-500', policy: 'AUTO-1053-K' },
    { name: 'Allstate', status: 'Verified', color: 'bg-green-500', policy: 'AUTO-9921-B' },
    { name: 'National General', status: 'Expiring', color: 'bg-yellow-500', policy: 'AUTO-4411-M' },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((i) => (i + 1) % carriers.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-navy rounded-xl p-4 font-mono text-xs h-48 overflow-hidden flex flex-col">
      <p className="text-white/30 text-[10px] uppercase tracking-wider mb-3">Carrier Verification</p>
      <div className="flex-1 space-y-2">
        {carriers.map((c, i) => (
          <div
            key={c.policy}
            className={`flex items-center justify-between p-2 rounded-lg transition-all duration-500 ${
              i === activeIndex ? 'bg-white/10' : 'bg-white/[0.03]'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${c.color}`} />
              <span className="text-white/80">{c.name}</span>
            </div>
            <span className={`text-[10px] font-semibold ${
              c.status === 'Verified' ? 'text-green-400' :
              c.status === 'Lapsed' ? 'text-red-400' : 'text-yellow-400'
            }`}>{c.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Feature 3: Compliance Dashboard ──────────────── */
function ComplianceDashboard() {
  const stats = [
    { label: 'Verified', count: 142, color: 'text-green-400', bg: 'bg-green-400' },
    { label: 'Pending', count: 8, color: 'text-yellow-400', bg: 'bg-yellow-400' },
    { label: 'Lapsed', count: 3, color: 'text-red-400', bg: 'bg-red-400' },
  ];
  const total = stats.reduce((s, x) => s + x.count, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 h-48 overflow-hidden">
      <p className="text-[10px] font-mono text-gray-400 uppercase tracking-wider mb-3">Portfolio Overview</p>
      {/* Bar */}
      <div className="flex h-3 rounded-full overflow-hidden mb-4">
        {stats.map((s) => (
          <div key={s.label} className={`${s.bg} transition-all`} style={{ width: `${(s.count / total) * 100}%` }} />
        ))}
      </div>
      {/* Stats */}
      <div className="space-y-2">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${s.bg}`} />
              <span className="text-navy/70">{s.label}</span>
            </div>
            <span className={`font-mono font-semibold ${s.color}`}>{s.count}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1 text-[10px] text-accent/60 font-mono">
        <Users className="w-3 h-3" />
        Team access · Role-based permissions
      </div>
    </div>
  );
}

/* ─── Features Section ───────────────────────────── */
const features = [
  {
    icon: Camera,
    title: 'Borrower Intake & OCR',
    description:
      'Send borrowers a link via email or SMS. They upload their insurance card and our OCR extracts policy details automatically — no manual data entry.',
    Component: IntakeDemo,
  },
  {
    icon: ShieldCheck,
    title: 'Carrier Verification',
    description:
      'We verify coverage directly with Progressive, State Farm, Allstate, and National General. Weekly automated checks catch lapses before they become losses.',
    Component: VerificationStatus,
  },
  {
    icon: Users,
    title: 'Compliance Dashboard',
    description:
      'See every borrower\'s insurance status at a glance. Track verification history, manage your team with role-based access, and export compliance reports.',
    Component: ComplianceDashboard,
  },
];

export default function Features() {
  const sectionRef = useRef(null);
  const cardsRef = useRef([]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      cardsRef.current.forEach((card) => {
        if (!card) return;
        gsap.fromTo(
          card,
          { opacity: 0, y: 60 },
          {
            opacity: 1,
            y: 0,
            duration: 0.8,
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
      id="features"
      ref={sectionRef}
      className="py-24 md:py-32 bg-offwhite"
    >
      <div className="max-w-6xl mx-auto px-6">
        {/* Section Header */}
        <div className="text-center mb-16">
          <span className="text-xs font-mono tracking-widest uppercase text-accent mb-4 block">
            Capabilities
          </span>
          <h2 className="text-3xl md:text-5xl font-extrabold text-navy leading-tight">
            Everything you need to
            <br />
            <span className="font-serif italic text-accent">stay protected.</span>
          </h2>
        </div>

        {/* Feature Cards */}
        <div className="grid md:grid-cols-3 gap-8">
          {features.map((feature, i) => (
            <div
              key={feature.title}
              ref={(el) => (cardsRef.current[i] = el)}
              className="opacity-0 group bg-white rounded-2xl border border-gray-100 p-6 hover-lift shadow-sm hover:shadow-lg transition-shadow duration-300"
            >
              {/* Interactive Widget */}
              <div className="mb-6">
                <feature.Component />
              </div>

              {/* Icon + Title */}
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                  <feature.icon className="w-5 h-5 text-accent" />
                </div>
                <h3 className="text-lg font-bold text-navy">{feature.title}</h3>
              </div>

              {/* Description */}
              <p className="text-sm text-carbon/70 leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
