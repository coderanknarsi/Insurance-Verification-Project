import { useState, useEffect, useRef } from 'react';
import { Shield, Menu, X } from 'lucide-react';

const DASHBOARD_BASE = import.meta.env.VITE_DASHBOARD_URL || 'https://app.autolientracker.com';
const SIGNUP_URL = `${DASHBOARD_BASE}?mode=signup`;

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'How It Works', href: '#protocol' },
  { label: 'Pricing', href: '#pricing' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      ref={navRef}
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] ${
        scrolled
          ? 'bg-navy/90 backdrop-blur-xl shadow-2xl shadow-navy/20 px-6 py-2 rounded-full max-w-lg'
          : 'bg-transparent px-8 py-4 rounded-2xl max-w-5xl'
      } w-[95%]`}
    >
      <div className="flex items-center justify-between">
        {/* Logo */}
        <a href="#" className="flex items-center gap-2 group">
          <Shield
            className={`transition-all duration-500 ${
              scrolled ? 'w-5 h-5 text-accent' : 'w-6 h-6 text-accent'
            }`}
            strokeWidth={2}
          />
          <span
            className={`font-semibold tracking-tight transition-all duration-500 ${
              scrolled ? 'text-sm text-white' : 'text-base text-white'
            }`}
          >
            Auto Lien Tracker
          </span>
        </a>

        {/* Desktop Links */}
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`text-sm font-medium transition-colors duration-200 hover:text-accent ${
                scrolled ? 'text-white/70' : 'text-white/80'
              }`}
            >
              {link.label}
            </a>
          ))}
          <a
            href={SIGNUP_URL}
            className={`btn-magnetic text-sm font-semibold px-5 py-2 rounded-full transition-all duration-300 ${
              scrolled
                ? 'bg-accent text-white hover:bg-accent/90'
                : 'bg-navy text-white hover:bg-navy/90'
            }`}
          >
            Get Started Free
          </a>
        </div>

        {/* Mobile Toggle */}
        <button
          className="md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? (
            <X className="text-white" />
          ) : (
            <Menu className="text-white" />
          )}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="md:hidden mt-4 pb-4 flex flex-col gap-3 border-t border-white/10 pt-4">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={`text-sm font-medium ${
                scrolled ? 'text-white/80' : 'text-white/80'
              }`}
            >
              {link.label}
            </a>
          ))}
          <a
            href={SIGNUP_URL}
            onClick={() => setMobileOpen(false)}
            className="text-sm font-semibold bg-accent text-white px-5 py-2 rounded-full text-center"
          >
            Get Started Free
          </a>
        </div>
      )}
    </nav>
  );
}
