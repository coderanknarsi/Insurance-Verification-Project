import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const manifesto = [
  'We believe every auto loan deserves',
  'continuous insurance verification —',
  'not quarterly spot-checks.',
  '',
  'Auto Lien Tracker was built for dealers,',
  'banks, and credit unions who refuse',
  'to leave collateral unprotected.',
  '',
  'We replaced manual processes with',
  'real-time automation. Because your',
  'portfolio risk shouldn\'t depend on',
  'a spreadsheet.',
];

export default function Philosophy() {
  const sectionRef = useRef(null);
  const wordsRef = useRef([]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      wordsRef.current.forEach((word) => {
        if (!word) return;
        gsap.fromTo(
          word,
          { opacity: 0.15 },
          {
            opacity: 1,
            duration: 0.4,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: word,
              start: 'top 80%',
              end: 'top 50%',
              scrub: 1,
            },
          }
        );
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  let wordIndex = 0;

  return (
    <section
      ref={sectionRef}
      className="relative py-32 md:py-48 bg-navy overflow-hidden"
    >
      {/* Parallax Texture */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
        }}
      />

      <div className="relative z-10 max-w-4xl mx-auto px-6">
        {/* Label */}
        <span className="text-xs font-mono tracking-widest uppercase text-accent/60 mb-12 block text-center">
          Our Philosophy
        </span>

        {/* Manifesto Text – word-by-word reveal */}
        <div className="text-center">
          {manifesto.map((line, lineIdx) => {
            if (line === '') {
              return <div key={`break-${lineIdx}`} className="h-8" />;
            }

            const words = line.split(' ');
            return (
              <p key={lineIdx} className="mb-1">
                {words.map((word, wi) => {
                  const currentIndex = wordIndex++;
                  return (
                    <span
                      key={`${lineIdx}-${wi}`}
                      ref={(el) => (wordsRef.current[currentIndex] = el)}
                      className="inline-block text-2xl md:text-4xl lg:text-5xl font-light text-white/90 mr-[0.3em] leading-snug"
                    >
                      {word}
                    </span>
                  );
                })}
              </p>
            );
          })}
        </div>
      </div>
    </section>
  );
}
