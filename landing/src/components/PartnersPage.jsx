import {
  Shield,
  ArrowRight,
  Plug,
  Zap,
  ShieldCheck,
  Webhook,
  RefreshCw,
  Lock,
  CheckCircle2,
} from 'lucide-react';

const DASHBOARD_BASE = import.meta.env.VITE_DASHBOARD_URL || 'https://app.autolientracker.com';
const CONTACT_EMAIL = 'info@autolientracker.com';

const steps = [
  {
    icon: Plug,
    title: 'Your platform pushes a deal',
    body: 'When a deal closes in your DMS or CRM, send one authenticated REST call with the borrower, vehicle, and loan number. That is the entire integration on your side.',
  },
  {
    icon: Zap,
    title: 'We create the borrower & request insurance',
    body: 'Auto Lien Tracker creates the borrower and vehicle, opens a policy record, and automatically texts the borrower a secure link to submit proof of insurance — no manual data entry for the dealer.',
  },
  {
    icon: ShieldCheck,
    title: 'We verify coverage directly with the carrier',
    body: 'Coverage is verified against the carrier and monitored for lapses, expirations, and lienholder accuracy on an ongoing basis.',
  },
  {
    icon: Webhook,
    title: 'Status streams back to you',
    body: 'Every status change is delivered to your platform as a signed webhook, so the verification state lives right inside the software your dealers already use.',
  },
];

const partnerBenefits = [
  {
    icon: CheckCircle2,
    title: 'Free for the platform',
    body: 'There is no cost to integrate. We want your dealers to have insurance verification built in — the dealerships are our customers, not you.',
  },
  {
    icon: RefreshCw,
    title: 'Zero double entry',
    body: 'Deals flow in automatically as they close. Dealers never re-key a borrower into a second system.',
  },
  {
    icon: Lock,
    title: 'Secure by design',
    body: 'Bearer API keys scoped per organization, HMAC-signed webhooks, idempotent writes, and strict tenant isolation.',
  },
];

export default function PartnersPage() {
  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white/80">
      {/* Header */}
      <header className="max-w-5xl mx-auto px-6 pt-12">
        <a href="/" className="inline-flex items-center gap-2 group mb-16">
          <Shield className="w-6 h-6 text-accent" />
          <span className="text-lg font-semibold text-white tracking-tight">
            Auto Lien Tracker
          </span>
        </a>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 mb-6">
          <Plug className="w-3.5 h-3.5 text-accent" />
          <span className="text-xs font-mono uppercase tracking-widest text-accent">
            Deals API for DMS & CRM Platforms
          </span>
        </div>

        <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight max-w-3xl mb-6">
          Insurance verification, built into your platform.
        </h1>

        <p className="text-lg text-white/50 leading-relaxed max-w-2xl mb-8">
          Auto Lien Tracker integrates directly with dealer management systems and
          CRMs. When a deal closes in your software, we automatically collect proof
          of insurance from the borrower, verify coverage with the carrier, and send
          the status back to you. Your dealers get continuous insurance compliance
          without leaving the tools they already use.
        </p>

        <div className="flex flex-wrap gap-4">
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=Deals%20API%20Integration`}
            className="btn-magnetic inline-flex items-center gap-2 bg-accent text-white text-sm font-semibold px-6 py-3 rounded-full hover:bg-accent/90 transition-all duration-300"
          >
            Talk to us about integrating
            <ArrowRight className="w-4 h-4" />
          </a>
          <a
            href="#how-it-works"
            className="inline-flex items-center gap-2 border border-white/15 text-white/80 text-sm font-semibold px-6 py-3 rounded-full hover:border-white/30 transition-all duration-300"
          >
            See how it works
          </a>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="max-w-5xl mx-auto px-6 py-16 border-t border-white/[0.06]">
        <h2 className="text-2xl font-bold text-white mb-2">How the integration works</h2>
        <p className="text-sm text-white/40 mb-10">
          One inbound call from your platform. Everything after that is automated.
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          {steps.map((step, i) => (
            <div
              key={step.title}
              className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                  <step.icon className="w-4.5 h-4.5 text-accent" />
                </div>
                <span className="text-xs font-mono text-white/30">
                  STEP {String(i + 1).padStart(2, '0')}
                </span>
              </div>
              <h3 className="text-base font-semibold text-white mb-2">{step.title}</h3>
              <p className="text-sm text-white/50 leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Code sample */}
      <section className="max-w-5xl mx-auto px-6 py-16 border-t border-white/[0.06]">
        <h2 className="text-2xl font-bold text-white mb-2">A single call to push a deal</h2>
        <p className="text-sm text-white/40 mb-8">
          Authenticate with a per-organization API key. Pass an idempotency key and
          retries are safe.
        </p>

        <div className="bg-[#0b1322] rounded-2xl border border-white/[0.06] overflow-hidden shadow-2xl shadow-black/40">
          <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/[0.06]">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
            <span className="ml-3 text-[10px] font-mono text-white/30 uppercase tracking-wider">
              POST /v1/deals
            </span>
          </div>
          <pre className="p-6 text-xs md:text-sm font-mono leading-relaxed overflow-x-auto">
{`curl https://api.autolientracker.com/v1/deals \\
  -H "Authorization: Bearer alt_live_..." \\
  -H "Idempotency-Key: DLR-90412" \\
  -d '{
    `}<span className="text-accent">"borrower"</span>{`: {
      `}<span className="text-green-400">"firstName"</span>{`:  "Jane",
      `}<span className="text-green-400">"lastName"</span>{`:   "Doe",
      `}<span className="text-green-400">"email"</span>{`:      "jane@example.com",
      `}<span className="text-green-400">"phone"</span>{`:      "+13105551234",
      `}<span className="text-green-400">"loanNumber"</span>{`: "DLR-90412"
    },
    `}<span className="text-accent">"vehicle"</span>{`: {
      `}<span className="text-green-400">"vin"</span>{`:   "1HGCM82633A004352",
      `}<span className="text-green-400">"year"</span>{`:  2023,
      `}<span className="text-green-400">"make"</span>{`:  "Honda",
      `}<span className="text-green-400">"model"</span>{`: "Accord"
    }
  }'

`}<span className="text-white/30">{`# → 201 Created`}</span>{`
{
  `}<span className="text-accent">"policyId"</span>{`:        "shtVTZuYz9JPxbOXaroB",
  `}<span className="text-accent">"borrowerId"</span>{`:      "a1B2c3D4...",
  `}<span className="text-accent">"isNewBorrower"</span>{`:   true,
  `}<span className="text-accent">"intakeRequested"</span>{`: true
}`}
          </pre>
        </div>

        <div className="mt-6 bg-[#0b1322] rounded-2xl border border-white/[0.06] overflow-hidden shadow-2xl shadow-black/40">
          <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/[0.06]">
            <Webhook className="w-3.5 h-3.5 text-accent/70" />
            <span className="ml-1 text-[10px] font-mono text-white/30 uppercase tracking-wider">
              Webhook → your endpoint
            </span>
          </div>
          <pre className="p-6 text-xs md:text-sm font-mono leading-relaxed overflow-x-auto">
{`POST https://your-platform.com/webhooks/autolien
X-AutoLien-Signature: v1=<hmac-sha256>

{
  `}<span className="text-accent">"event"</span>{`:           "policy.verification.updated",
  `}<span className="text-accent">"policyId"</span>{`:        "shtVTZuYz9JPxbOXaroB",
  `}<span className="text-accent">"loanNumber"</span>{`:      "DLR-90412",
  `}<span className="text-accent">"status"</span>{`:          "ACTIVE",
  `}<span className="text-accent">"isLienholderListed"</span>{`: true,
  `}<span className="text-accent">"lastVerifiedAt"</span>{`:  "2026-06-12T03:32:05Z"
}`}
          </pre>
        </div>
      </section>

      {/* Partner benefits */}
      <section className="max-w-5xl mx-auto px-6 py-16 border-t border-white/[0.06]">
        <h2 className="text-2xl font-bold text-white mb-2">Why platforms partner with us</h2>
        <p className="text-sm text-white/40 mb-10">
          We make the integration valuable for your product and effortless for your team.
        </p>

        <div className="grid md:grid-cols-3 gap-6">
          {partnerBenefits.map((b) => (
            <div
              key={b.title}
              className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6"
            >
              <div className="w-9 h-9 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-4">
                <b.icon className="w-4.5 h-4.5 text-accent" />
              </div>
              <h3 className="text-base font-semibold text-white mb-2">{b.title}</h3>
              <p className="text-sm text-white/50 leading-relaxed">{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-6 py-20 border-t border-white/[0.06]">
        <div className="bg-navy rounded-3xl px-8 md:px-12 py-12 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">
            Let’s connect your platform.
          </h2>
          <p className="text-white/50 max-w-xl mx-auto mb-8">
            Whether you build a DMS, a CRM, or any cloud product your dealers rely on,
            we’ll work with your team to ship the integration. Reach out and we’ll send
            you API credentials and the full developer guide.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <a
              href={`mailto:${CONTACT_EMAIL}?subject=Deals%20API%20Integration`}
              className="btn-magnetic inline-flex items-center gap-2 bg-accent text-white text-sm font-semibold px-6 py-3 rounded-full hover:bg-accent/90 transition-all duration-300"
            >
              Email our integrations team
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href={DASHBOARD_BASE}
              className="inline-flex items-center gap-2 border border-white/15 text-white/80 text-sm font-semibold px-6 py-3 rounded-full hover:border-white/30 transition-all duration-300"
            >
              Visit the dashboard
            </a>
          </div>
        </div>

        <div className="mt-12 text-center">
          <a href="/" className="text-sm text-white/40 hover:text-accent transition-colors">
            ← Back to home
          </a>
        </div>
      </section>
    </div>
  );
}
