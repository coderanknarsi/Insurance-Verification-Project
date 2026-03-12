import { Shield } from 'lucide-react';

const footerLinks = [
  {
    heading: 'Product',
    links: [
      { label: 'Features', href: '#features' },
      { label: 'How It Works', href: '#protocol' },
      { label: 'Pricing', href: '#pricing' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '#' },
      { label: 'Contact', href: 'mailto:hello@autolientracker.com' },
      { label: 'Careers', href: '#' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy Policy', href: '#' },
      { label: 'Terms of Service', href: '#' },
      { label: 'Security', href: '#' },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="bg-navy rounded-t-[3rem] mt-[-3rem] relative z-10">
      <div className="max-w-6xl mx-auto px-6 pt-20 pb-10">
        {/* Top Row */}
        <div className="flex flex-col md:flex-row justify-between gap-12 mb-16">
          {/* Brand */}
          <div className="max-w-xs">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-6 h-6 text-accent" />
              <span className="text-lg font-semibold text-white tracking-tight">
                Auto Lien Tracker
              </span>
            </div>
            <p className="text-sm text-white/40 leading-relaxed">
              Automated insurance verification for auto lenders. Protect every
              vehicle in your portfolio.
            </p>
          </div>

          {/* Links */}
          <div className="flex gap-16 flex-wrap">
            {footerLinks.map((group) => (
              <div key={group.heading}>
                <h4 className="text-xs font-mono uppercase tracking-widest text-white/30 mb-4">
                  {group.heading}
                </h4>
                <ul className="space-y-2">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="text-sm text-white/50 hover:text-accent transition-colors"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/[0.06] pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* System Status */}
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-green-400 rounded-full pulse-dot" />
            <span className="text-xs font-mono text-white/30">
              System Operational
            </span>
          </div>

          {/* Copyright */}
          <p className="text-xs text-white/20">
            &copy; {new Date().getFullYear()} Auto Lien Tracker. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
