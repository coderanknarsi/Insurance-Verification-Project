"use client";

import { useState } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  OAuthProvider,
  signOut,
} from "firebase/auth";
import { getClientAuth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, Chrome } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { DashboardSummary } from "@/components/dashboard-summary";
import { DashboardWidgets } from "@/components/dashboard-widgets";
import { BorrowerTable } from "@/components/borrower-table";
import { BorrowerDetailPanel } from "@/components/borrower-detail-panel";
import { ComplianceSettings } from "@/components/compliance-settings";
import { BillingSettings } from "@/components/billing-settings";
import type { BorrowerWithVehicles } from "@/lib/api";

// TODO: Replace with actual org ID from authenticated user's profile
const DEMO_ORG_ID = process.env.NEXT_PUBLIC_ORG_ID ?? "";

export default function Home() {
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [isSignUp, setIsSignUp] = useState(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("mode") === "signup";
    }
    return false;
  });
  const [activeNav, setActiveNav] = useState("dashboard");
  const [selectedBorrower, setSelectedBorrower] = useState<BorrowerWithVehicles | null>(null);
  const [allBorrowers, setAllBorrowers] = useState<BorrowerWithVehicles[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigningIn(true);
    setError(null);
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(getClientAuth(), email, password);
      } else {
        await signInWithEmailAndPassword(getClientAuth(), email, password);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      setError(msg.replace("Firebase: ", "").replace(/\(auth\/.*\)/, "").trim());
    } finally {
      setSigningIn(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    try {
      await signInWithPopup(getClientAuth(), new GoogleAuthProvider());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Google sign-in failed";
      setError(msg.replace("Firebase: ", "").replace(/\(auth\/.*\)/, "").trim());
    }
  };

  const handleAppleSignIn = async () => {
    setError(null);
    try {
      const provider = new OAuthProvider("apple.com");
      provider.addScope("email");
      provider.addScope("name");
      await signInWithPopup(getClientAuth(), provider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Apple sign-in failed";
      setError(msg.replace("Firebase: ", "").replace(/\(auth\/.*\)/, "").trim());
    }
  };

  const handleSignOut = async () => {
    await signOut(getClientAuth());
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-accent/20 rounded-lg flex items-center justify-center animate-pulse">
            <Shield className="w-4 h-4 text-accent" />
          </div>
          <p className="text-carbon-light text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm">
          {/* Brand */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-10 h-10 bg-accent/20 rounded-xl flex items-center justify-center">
              <Shield className="w-5 h-5 text-accent" />
            </div>
            <span className="text-xl font-semibold text-offwhite tracking-tight">
              Auto Lien Tracker
            </span>
          </div>

          {/* Auth Card */}
          <div className="bg-card-bg border border-border-subtle rounded-2xl p-8">
            <h2 className="text-lg font-semibold text-offwhite text-center mb-1">
              {isSignUp ? "Start your free pilot" : "Welcome back"}
            </h2>
            <p className="text-sm text-carbon-light text-center mb-6">
              {isSignUp ? "Create your account to get started" : "Sign in to your dashboard"}
            </p>

            {/* Social Sign-In */}
            <div className="space-y-3 mb-6">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 text-gray-800 font-medium text-sm py-2.5 px-4 rounded-lg border border-gray-300 transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </button>
              <button
                type="button"
                onClick={handleAppleSignIn}
                className="w-full flex items-center justify-center gap-3 bg-black hover:bg-gray-900 text-white font-medium text-sm py-2.5 px-4 rounded-lg border border-gray-700 transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                </svg>
                Continue with Apple
              </button>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 h-px bg-border-subtle" />
              <span className="text-xs text-carbon-light">or continue with email</span>
              <div className="flex-1 h-px bg-border-subtle" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm text-carbon-light">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-surface border-border-subtle text-offwhite placeholder:text-carbon focus:border-accent focus:ring-accent/30"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm text-carbon-light">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="bg-surface border-border-subtle text-offwhite placeholder:text-carbon focus:border-accent focus:ring-accent/30"
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <Button
                type="submit"
                className="w-full bg-accent hover:bg-accent-hover text-white font-medium rounded-lg"
                disabled={signingIn}
              >
                {signingIn
                  ? (isSignUp ? "Creating account..." : "Signing in...")
                  : (isSignUp ? "Create Account" : "Sign In")}
              </Button>
            </form>

            <p className="text-center text-xs text-carbon-light mt-4">
              {isSignUp ? "Already have an account?" : "Don\u2019t have an account?"}{" "}
              <button
                type="button"
                onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
                className="text-accent hover:text-accent/80 font-medium transition-colors"
              >
                {isSignUp ? "Sign in" : "Start free pilot"}
              </button>
            </p>
          </div>

          <p className="text-center text-xs text-carbon mt-4">
            Protected by bank-grade encryption
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <Sidebar
        userEmail={user.email ?? ""}
        onSignOut={handleSignOut}
        activeNav={activeNav}
        onNavChange={setActiveNav}
      />

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {/* Top Bar */}
        <header className="h-16 border-b border-border-subtle flex items-center justify-between px-8">
          <div>
            <h1 className="text-lg font-semibold text-offwhite">
              {activeNav === "dashboard" && "Dashboard"}
              {activeNav === "verifications" && "Verifications"}
              {activeNav === "billing" && "Billing"}
              {activeNav === "settings" && "Settings"}
            </h1>
            <p className="text-xs text-carbon-light">Portfolio monitoring & insurance verification</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-green-400 rounded-full pulse-glow" />
              <span className="text-xs font-mono text-carbon-light">System Online</span>
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="p-8 space-y-6">
          {activeNav === "dashboard" && (
            <>
              <DashboardSummary organizationId={DEMO_ORG_ID} />
              <DashboardWidgets borrowers={allBorrowers} />
              <BorrowerTable
                organizationId={DEMO_ORG_ID}
                onSelectBorrower={setSelectedBorrower}
                onBorrowersLoaded={setAllBorrowers}
              />
            </>
          )}
          {activeNav === "billing" && (
            <BillingSettings organizationId={DEMO_ORG_ID} />
          )}
          {activeNav === "settings" && (
            <ComplianceSettings organizationId={DEMO_ORG_ID} />
          )}
        </div>
      </main>

      {/* Detail Panel */}
      {selectedBorrower && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setSelectedBorrower(null)}
          />
          <BorrowerDetailPanel
            borrower={selectedBorrower}
            onClose={() => setSelectedBorrower(null)}
          />
        </>
      )}
    </div>
  );
}
