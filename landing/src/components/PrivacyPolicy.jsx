import { Shield } from 'lucide-react';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white/80">
      <div className="max-w-3xl mx-auto px-6 py-20">
        <a href="/" className="flex items-center gap-2 mb-12 group">
          <Shield className="w-6 h-6 text-accent" />
          <span className="text-lg font-semibold text-white tracking-tight">Auto Lien Tracker</span>
        </a>

        <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-sm text-white/40 mb-10">Last updated: April 21, 2026</p>

        <div className="space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. Introduction</h2>
            <p>
              Auto Lien Tracker ("we," "us," or "our") operates the website at autolientracker.com
              and the Auto Lien Tracker platform. This Privacy Policy explains how we collect, use,
              disclose, and safeguard your information when you use our services.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. Information We Collect</h2>
            <p className="mb-3">We collect information that you provide directly to us, including:</p>
            <ul className="list-disc list-inside space-y-1 text-white/70">
              <li>Name, email address, and phone number</li>
              <li>Company or dealership name and business type</li>
              <li>Vehicle and loan information</li>
              <li>Insurance policy documents and details</li>
              <li>Account credentials and preferences</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. How We Use Your Information</h2>
            <p className="mb-3">We use collected information to:</p>
            <ul className="list-disc list-inside space-y-1 text-white/70">
              <li>Provide and maintain our insurance verification services</li>
              <li>Send notifications about insurance policy status via email and SMS</li>
              <li>Send expiry reminders and proof-of-insurance upload requests</li>
              <li>Process and verify insurance documents</li>
              <li>Communicate with you about your account and our services</li>
              <li>Improve and optimize our platform</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. SMS/Text Messaging</h2>
            <p className="mb-3">
              By providing your phone number through our platform, you consent to receive
              text messages from Auto Lien Tracker regarding your insurance status.
              Message frequency varies based on your policy status. Message and data rates
              may apply. You can opt out at any time by replying STOP to any message.
              Reply HELP for assistance.
            </p>
            <p>
              We do not sell, rent, or share your phone number or SMS opt-in data with
              third parties for their marketing purposes. Phone numbers collected for SMS
              notifications are used solely for delivering insurance-related communications.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Data Sharing</h2>
            <p className="mb-3">
              We do not sell your personal information to third parties. We may share your
              information only in the following circumstances:
            </p>
            <ul className="list-disc list-inside space-y-1 text-white/70">
              <li>With the auto lender or dealership that manages your loan (your information is shared only with the organization that added you to the platform)</li>
              <li>With service providers who assist in operating our platform (e.g., hosting, email delivery, SMS delivery)</li>
              <li>When required by law or to protect our legal rights</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. Data Security</h2>
            <p>
              We implement industry-standard security measures to protect your data,
              including encryption in transit and at rest, secure cloud infrastructure,
              and access controls. However, no method of transmission over the Internet
              is 100% secure.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Data Retention</h2>
            <p>
              We retain your information for as long as your account is active or as
              needed to provide services. We will delete or anonymize your information
              upon request, subject to any legal obligations to retain certain records.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. Your Rights</h2>
            <p className="mb-3">You have the right to:</p>
            <ul className="list-disc list-inside space-y-1 text-white/70">
              <li>Access the personal information we hold about you</li>
              <li>Request correction of inaccurate information</li>
              <li>Request deletion of your information</li>
              <li>Opt out of SMS communications at any time by replying STOP</li>
              <li>Opt out of email communications via the unsubscribe link in any email</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">9. Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy, please contact us at{' '}
              <a href="mailto:info@autolientracker.com" className="text-accent hover:text-accent/80">
                info@autolientracker.com
              </a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
