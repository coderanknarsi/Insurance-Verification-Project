"use client";

/**
 * One-time welcome modal shown to demo-org users on first login.
 *
 * Walks them through the core value prop in 3 bullets and points them at the
 * Add Borrower button as the first thing to try. Dismissed via localStorage
 * so it doesn't reappear on refresh; re-shows if they clear storage.
 */

import { X, ShieldCheck, Send, Activity, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DemoWelcomeModalProps {
  open: boolean;
  onClose: () => void;
  /** Called when they click the primary CTA. Should open AddBorrowerDialog. */
  onTryIt: () => void;
}

export function DemoWelcomeModal({ open, onClose, onTryIt }: DemoWelcomeModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-xl bg-card-bg border border-border-subtle rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-border-subtle flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-accent font-medium mb-1">Welcome to Auto Lien Tracker</p>
            <h2 className="text-xl font-semibold text-offwhite">Try the full borrower flow in 60 seconds</h2>
          </div>
          <button
            onClick={onClose}
            className="text-carbon-light hover:text-offwhite transition-colors -mt-1"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-carbon-light leading-relaxed">
            We monitor insurance compliance for every loan in your portfolio.
            Best way to understand it is to <strong className="text-offwhite">add yourself as a test borrower</strong> — you&apos;ll
            walk through what your customers see end-to-end.
          </p>

          <div className="space-y-3">
            <Step
              icon={<Send className="w-4 h-4" />}
              title="1. We text the borrower a secure link"
              body="You'll get the SMS on your real phone — same as a customer would."
            />
            <Step
              icon={<ShieldCheck className="w-4 h-4" />}
              title="2. They upload their insurance card"
              body="We attempt to auto-extract carrier, policy number, dates, VIN, and lienholder so you can review the details quickly. You can use the sample card we generate for you."
            />
            <Step
              icon={<Activity className="w-4 h-4" />}
              title="3. Their compliance status updates"
              body="The dashboard reflects new submissions and flags common issues like wrong vehicle, expired policies, and missing lienholders for review."
            />
          </div>

          <div className="px-4 py-3 bg-accent/5 border border-accent/20 rounded-lg flex items-start gap-2">
            <FlaskConical className="w-4 h-4 text-accent shrink-0 mt-0.5" />
            <p className="text-xs text-carbon-light leading-relaxed">
              <strong className="text-offwhite">Demo mode:</strong> nothing is sent to real
              customers. Your test borrower stays in the demo account so you can return tomorrow
              and see the full audit trail.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-subtle flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="text-xs text-carbon-light hover:text-offwhite transition-colors"
          >
            Skip — let me explore on my own
          </button>
          <Button
            onClick={() => {
              onClose();
              onTryIt();
            }}
            className="bg-accent hover:bg-accent-hover text-white"
          >
            Try it — add myself as a test borrower
          </Button>
        </div>
      </div>
    </div>
  );
}

function Step({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-offwhite">{title}</p>
        <p className="text-xs text-carbon-light leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
