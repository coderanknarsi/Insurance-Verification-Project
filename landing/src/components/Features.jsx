import { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Radio, AlertTriangle, MousePointerClick } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

/* ─── Feature 1: Diagnostic Shuffler ─────────────── */
function DiagnosticShuffler() {
  const [activeIndex, setActiveIndex] = useState(0);
  const cards = [
    {
      status: 'COMPLIANT',
      color: 'bg-green-500',
      borrower: 'Martinez, R.',
      policy: 'AUTO-2847-X',
      expires: '2025-09-14',
    },
    {
      status: 'AT RISK',
      color: 'bg-yellow-500',
      borrower: 'Chen, W.',
      policy: 'AUTO-1053-K',
      expires: '2025-02-28',
    },
    {
      status: 'LAPSED',
      color: 'bg-red-500',
      borrower: 'Thompson, J.',
      policy: 'AUTO-4411-M',
      expires: '2024-12-01',
    },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((i) => (i + 1) % cards.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative h-48 w-full">
      {cards.map((card, i) => {
        const offset = ((i - activeIndex + cards.length) % cards.length);
        const isActive = offset === 0;
        return (
          <div
            key={card.policy}
            className={`absolute inset-x-0 mx-auto w-[90%] bg-white rounded-xl border border-gray-100 shadow-lg p-4 transition-all duration-500 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] ${
              isActive ? 'z-30 translate-y-0 scale-100 opacity-100' :
              offset === 1 ? 'z-20 translate-y-4 scale-[0.96] opacity-60' :
              'z-10 translate-y-8 scale-[0.92] opacity-30'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full text-white ${card.color}`}>
                {card.status}
              </span>
              <span className="text-xs text-gray-400 font-mono">{card.policy}</span>
            </div>
            <p className="text-sm font-semibold text-navy">{card.borrower}</p>
            <p className="text-xs text-gray-400 mt-1">Expires: {card.expires}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Feature 2: Telemetry Typewriter ────────────── */
function TelemetryTypewriter() {
  const [lines, setLines] = useState([]);
  const containerRef = useRef(null);

  const logEntries = [
    { text: '[SCAN] Policy AUTO-2847-X verified', color: 'text-green-400' },
    { text: '[WARN] Coverage gap detected: Chen, W.', color: 'text-yellow-400' },
    { text: '[ALERT] Policy lapsed: Thompson, J.', color: 'text-red-400' },
    { text: '[SCAN] Policy AUTO-9921-B verified', color: 'text-green-400' },
    { text: '[INFO] Dealer notification sent', color: 'text-accent' },
    { text: '[SCAN] Policy AUTO-3344-F verified', color: 'text-green-400' },
  ];

  useEffect(() => {
    let lineIndex = 0;
    const interval = setInterval(() => {
      setLines((prev) => {
        const next = [...prev, logEntries[lineIndex % logEntries.length]];
        if (next.length > 5) next.shift();
        return next;
      });
      lineIndex++;
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      ref={containerRef}
      className="bg-navy rounded-xl p-4 font-mono text-xs h-48 overflow-hidden flex flex-col justify-end"
    >
      {lines.map((line, i) => (
        <div
          key={`${i}-${line.text}`}
          className={`${line.color} transition-opacity duration-300`}
        >
          <span className="text-white/30 mr-2">{'>'}</span>
          {line.text}
          {i === lines.length - 1 && (
            <span className="cursor-blink ml-0.5 text-accent">▊</span>
          )}
        </div>
      ))}
      {lines.length === 0 && (
        <div className="text-white/30">
          <span className="mr-2">{'>'}</span>
          Initializing scanner
          <span className="cursor-blink ml-0.5 text-accent">▊</span>
        </div>
      )}
    </div>
  );
}

/* ─── Feature 3: Protocol Scheduler ──────────────── */
function ProtocolScheduler() {
  const [activeDay, setActiveDay] = useState(2);
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const tasks = [
    ['Scan batch A', 'Scan batch B'],
    ['Verify renewals'],
    ['Lapse check', 'Send alerts'],
    ['Scan batch C'],
    ['Weekly report', 'Compliance audit'],
    [],
    [],
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveDay((d) => (d + 1) % 7);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 h-48 overflow-hidden">
      <div className="flex gap-1 mb-3">
        {days.map((day, i) => (
          <div
            key={day}
            className={`flex-1 text-center text-[10px] font-mono py-1 rounded transition-all duration-300 ${
              i === activeDay
                ? 'bg-accent text-white font-semibold'
                : 'bg-gray-50 text-gray-400'
            }`}
          >
            {day}
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {(tasks[activeDay] || []).length > 0 ? (
          tasks[activeDay].map((task, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-xs bg-accent/5 text-navy p-2 rounded-lg border border-accent/10"
            >
              <div className="w-1.5 h-1.5 bg-accent rounded-full" />
              {task}
            </div>
          ))
        ) : (
          <p className="text-xs text-gray-300 font-mono text-center mt-6">
            No scheduled tasks
          </p>
        )}
      </div>
      {/* Animated cursor */}
      <div
        className="mt-3 flex items-center gap-1 text-[10px] text-accent/60 font-mono transition-opacity"
      >
        <MousePointerClick className="w-3 h-3" />
        Automated — no manual input required
      </div>
    </div>
  );
}

/* ─── Features Section ───────────────────────────── */
const features = [
  {
    icon: Radio,
    title: 'Real-Time Monitoring',
    description:
      'Continuous verification scans detect policy changes the moment they happen. No more quarterly spot-checks.',
    Component: DiagnosticShuffler,
  },
  {
    icon: AlertTriangle,
    title: 'Automated Lapse Detection',
    description:
      'Instant alerts when coverage gaps appear. Protect your collateral before losses occur.',
    Component: TelemetryTypewriter,
  },
  {
    icon: MousePointerClick,
    title: 'One-Click Verification',
    description:
      'Send borrowers a secure link to verify insurance. Results flow directly into your dashboard.',
    Component: ProtocolScheduler,
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
