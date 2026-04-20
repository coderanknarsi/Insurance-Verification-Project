"use client";

import { useCallback } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { callCreateCheckoutSession } from "@/lib/api";
import { X } from "lucide-react";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

interface EmbeddedCheckoutDialogProps {
  organizationId: string;
  mode: "subscription" | "setup";
  plan?: string;
  onClose: () => void;
  onComplete?: () => void;
}

export function EmbeddedCheckoutDialog({
  organizationId,
  mode,
  plan,
  onClose,
  onComplete,
}: EmbeddedCheckoutDialogProps) {
  const fetchClientSecret = useCallback(async () => {
    const result = await callCreateCheckoutSession({
      organizationId,
      mode,
      ...(plan && { plan }),
    });
    return result.data.clientSecret;
  }, [organizationId, mode, plan]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-xl mx-4 bg-card-bg border border-border-subtle rounded-2xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <div>
            <h3 className="text-base font-semibold text-offwhite">
              {mode === "setup" ? "Add Payment Method" : "Subscribe"}
            </h3>
            <p className="text-xs text-carbon-light mt-0.5">
              {mode === "setup"
                ? "Securely add your card to continue after your trial"
                : "Start your subscription with a 14-day free trial"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface transition-colors"
          >
            <X className="w-4 h-4 text-carbon-light" />
          </button>
        </div>

        {/* Checkout */}
        <div className="p-6 max-h-[70vh] overflow-y-auto bg-white rounded-b-2xl">
          <EmbeddedCheckoutProvider
            stripe={stripePromise}
            options={{
              fetchClientSecret,
              onComplete: () => {
                onComplete?.();
                onClose();
              },
            }}
          >
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    </div>
  );
}
