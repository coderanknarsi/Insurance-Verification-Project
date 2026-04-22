import { Shield } from 'lucide-react';

export default function TermsConditions() {
  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white/80">
      <div className="max-w-3xl mx-auto px-6 py-20">
        <a href="/" className="flex items-center gap-2 mb-12 group">
          <Shield className="w-6 h-6 text-accent" />
          <span className="text-lg font-semibold text-white tracking-tight">Auto Lien Tracker</span>
        </a>

        <h1 className="text-3xl font-bold text-white mb-2">Terms and Conditions</h1>
        <p className="text-sm text-white/40 mb-10">Last updated: April 21, 2026</p>

        <div className="space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. Acceptance of Terms</h2>
            <p>
              By accessing or using the Auto Lien Tracker platform ("Service"), you agree to
              be bound by these Terms and Conditions. If you do not agree to these terms,
              do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. Description of Service</h2>
            <p>
              Auto Lien Tracker provides automated insurance verification services for auto
              lenders, dealerships, and finance companies. The Service includes policy monitoring,
              compliance tracking, borrower notifications, and document management tools.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. User Accounts</h2>
            <p className="mb-3">
              To use the Service, you must create an account and provide accurate, complete
              information. You are responsible for:
            </p>
            <ul className="list-disc list-inside space-y-1 text-white/70">
              <li>Maintaining the confidentiality of your account credentials</li>
              <li>All activity that occurs under your account</li>
              <li>Notifying us immediately of any unauthorized use</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. SMS and Email Communications</h2>
            <p className="mb-3">
              By providing a phone number through the Service, you consent to receive
              automated text messages regarding insurance policy status, including but not
              limited to expiry reminders and proof-of-insurance upload requests.
            </p>
            <ul className="list-disc list-inside space-y-1 text-white/70">
              <li>Message frequency varies based on policy status and account settings</li>
              <li>Message and data rates may apply</li>
              <li>Consent is not a condition of purchase or use of the Service</li>
              <li>You may opt out at any time by replying STOP to any text message</li>
              <li>Reply HELP for assistance with text messaging</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Acceptable Use</h2>
            <p className="mb-3">You agree not to:</p>
            <ul className="list-disc list-inside space-y-1 text-white/70">
              <li>Use the Service for any unlawful purpose</li>
              <li>Upload fraudulent or falsified insurance documents</li>
              <li>Attempt to gain unauthorized access to the Service or its systems</li>
              <li>Interfere with or disrupt the Service</li>
              <li>Use the Service to send unsolicited messages or spam</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. Data and Privacy</h2>
            <p>
              Your use of the Service is also governed by our{' '}
              <a href="/privacy" className="text-accent hover:text-accent/80">Privacy Policy</a>,
              which describes how we collect, use, and protect your information.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Intellectual Property</h2>
            <p>
              The Service and its original content, features, and functionality are owned by
              Auto Lien Tracker and are protected by copyright, trademark, and other
              intellectual property laws.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. Disclaimer of Warranties</h2>
            <p>
              The Service is provided "as is" without warranties of any kind, either express
              or implied. Auto Lien Tracker does not guarantee the accuracy of insurance
              verification results and does not assume liability for decisions made based
              on information provided by the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">9. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, Auto Lien Tracker shall not be liable
              for any indirect, incidental, special, consequential, or punitive damages
              arising from your use of the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">10. Changes to Terms</h2>
            <p>
              We may update these Terms from time to time. We will notify you of material
              changes by posting the updated Terms on this page with a new "Last updated" date.
              Continued use of the Service after changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">11. Contact Us</h2>
            <p>
              If you have questions about these Terms, please contact us at{' '}
              <a href="mailto:support@autolientracker.com" className="text-accent hover:text-accent/80">
                support@autolientracker.com
              </a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
