"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  X,
  UserPlus,
  Loader2,
  CheckCircle,
  Car,
  MessageSquare,
  Send,
  FileText,
  Upload,
  ArrowLeft,
} from "lucide-react";
import { callIngestDealData, callRequestBorrowerIntake, callDealerSubmitInsurance } from "@/lib/api";
import type { IngestDealResult, IntakeRequestResult, DealerSubmitInsuranceResult } from "@/lib/api";

interface AddBorrowerDialogProps {
  organizationId: string;
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

interface VinDecodeResult {
  make: string;
  model: string;
  year: number;
}

type Step = "form" | "saving" | "success" | "manual-insurance" | "sending-request" | "done";

async function decodeVinClient(vin: string): Promise<VinDecodeResult | null> {
  try {
    const resp = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(vin)}?format=json`
    );
    if (!resp.ok) return null;
    const json = await resp.json();
    const r = json.Results?.[0];
    if (!r?.Make || !r?.Model || !r?.ModelYear) return null;
    const year = parseInt(r.ModelYear, 10);
    if (isNaN(year)) return null;
    return { make: r.Make, model: r.Model, year };
  } catch {
    return null;
  }
}

export function AddBorrowerDialog({
  organizationId,
  open,
  onClose,
  onComplete,
}: AddBorrowerDialogProps) {
  const [step, setStep] = useState<Step>("form");

  // Form fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loanNumber, setLoanNumber] = useState("");
  const [vin, setVin] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [vinDecoding, setVinDecoding] = useState(false);
  const [vinDecoded, setVinDecoded] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);

  // Result
  const [result, setResult] = useState<IngestDealResult | null>(null);
  const [intakeResult, setIntakeResult] = useState<IntakeRequestResult | null>(null);
  const [dealerInsuranceResult, setDealerInsuranceResult] = useState<DealerSubmitInsuranceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Manual insurance fields
  const [insProvider, setInsProvider] = useState("");
  const [insPolicyNum, setInsPolicyNum] = useState("");
  const [insCardBase64, setInsCardBase64] = useState<string | null>(null);
  const [insCardName, setInsCardName] = useState<string | null>(null);

  const reset = () => {
    setStep("form");
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setLoanNumber("");
    setVin("");
    setMake("");
    setModel("");
    setYear("");
    setVinDecoding(false);
    setVinDecoded(false);
    setSmsConsent(false);
    setResult(null);
    setIntakeResult(null);
    setDealerInsuranceResult(null);
    setError(null);
    setInsProvider("");
    setInsPolicyNum("");
    setInsCardBase64(null);
    setInsCardName(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // Auto-decode VIN when 17 characters entered
  const handleVinChange = useCallback(
    async (value: string) => {
      const cleaned = value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/gi, "");
      setVin(cleaned);
      setVinDecoded(false);

      if (cleaned.length === 17) {
        setVinDecoding(true);
        const decoded = await decodeVinClient(cleaned);
        if (decoded) {
          setMake(decoded.make);
          setModel(decoded.model);
          setYear(String(decoded.year));
          setVinDecoded(true);
        }
        setVinDecoding(false);
      }
    },
    []
  );

  const canSubmit =
    firstName.trim() && lastName.trim() && (email.trim() || phone.trim()) && vin.length === 17;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setStep("saving");
    setError(null);

    try {
      const res = await callIngestDealData({
        organizationId,
        borrower: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          ...(email.trim() && { email: email.trim() }),
          ...(phone.trim() && { phone: phone.trim() }),
          ...(loanNumber.trim() && { loanNumber: loanNumber.trim() }),
          ...(smsConsent && phone.trim() && { smsConsent: true }),
        },
        vehicle: {
          vin: vin.trim(),
          ...(make.trim() && { make: make.trim() }),
          ...(model.trim() && { model: model.trim() }),
          ...(year.trim() && { year: parseInt(year.trim(), 10) }),
        },
      });
      setResult(res.data);
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add borrower");
      setStep("form");
    }
  };

  const handleDone = () => {
    onComplete();
    handleClose();
  };

  const handleSendRequest = async () => {
    if (!result) return;
    setStep("sending-request");
    try {
      const res = await callRequestBorrowerIntake({
        organizationId,
        borrowerId: result.borrowerId,
        vehicleId: result.vehicleId,
        policyId: result.policyId,
      });
      setIntakeResult(res.data);
    } catch {
      // Non-critical
    }
    setStep("done");
  };

  const handleDealerSubmitInsurance = async () => {
    if (!result) return;
    if (!insProvider.trim() && !insPolicyNum.trim() && !insCardBase64) return;
    setStep("sending-request");
    setError(null);
    try {
      const res = await callDealerSubmitInsurance({
        organizationId,
        policyId: result.policyId,
        vehicleId: result.vehicleId,
        ...(insProvider.trim() && { insuranceProvider: insProvider.trim() }),
        ...(insPolicyNum.trim() && { policyNumber: insPolicyNum.trim() }),
        ...(insCardBase64 && { insuranceCardBase64: insCardBase64 }),
      });
      setDealerInsuranceResult(res.data);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit insurance");
      setStep("manual-insurance");
    }
  };

  const handleCardUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("File must be under 10MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      setInsCardBase64(base64);
      setInsCardName(file.name);
    };
    reader.readAsDataURL(file);
  };

  if (!open) return null;

  const borrowerName = `${firstName} ${lastName}`.trim();
  const vehicleLabel = make && model && year ? `${year} ${make} ${model}` : vin;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      <div className="relative w-full max-w-lg bg-card-bg border border-border-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <UserPlus className="w-5 h-5 text-accent" />
            <h2 className="text-base font-semibold text-offwhite">
              {step === "form" || step === "saving"
                ? "Add Borrower"
                : step === "manual-insurance"
                ? "Add Insurance Info"
                : "Borrower Added"}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="text-carbon-light hover:text-offwhite transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 overflow-y-auto max-h-[65vh]">
          {/* FORM STEP */}
          {(step === "form" || step === "saving") && (
            <div className="space-y-4">
              {error && (
                <div className="px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-xl">
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}

              {/* Borrower Info */}
              <div>
                <p className="text-xs font-medium text-carbon-light uppercase tracking-wider mb-3">
                  Borrower Information
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-carbon-light mb-1 block">
                      First Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="John"
                      disabled={step === "saving"}
                      className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite placeholder:text-carbon-light/50 focus:outline-none focus:border-accent disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-carbon-light mb-1 block">
                      Last Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Smith"
                      disabled={step === "saving"}
                      className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite placeholder:text-carbon-light/50 focus:outline-none focus:border-accent disabled:opacity-50"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="text-xs text-carbon-light mb-1 block">
                      Email <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="john@email.com"
                      disabled={step === "saving"}
                      className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite placeholder:text-carbon-light/50 focus:outline-none focus:border-accent disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-carbon-light mb-1 block">
                      Phone <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="555-123-4567"
                      disabled={step === "saving"}
                      className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite placeholder:text-carbon-light/50 focus:outline-none focus:border-accent disabled:opacity-50"
                    />
                  </div>
                </div>
                <div className="mt-1">
                  <p className="text-[10px] text-carbon-light">At least one contact method (email or phone) is required</p>
                </div>
                <div className="mt-3">
                  <label className="text-xs text-carbon-light mb-1 block">
                    Loan Number
                  </label>
                  <input
                    type="text"
                    value={loanNumber}
                    onChange={(e) => setLoanNumber(e.target.value)}
                    placeholder="LN-2024-001"
                    disabled={step === "saving"}
                    className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite placeholder:text-carbon-light/50 focus:outline-none focus:border-accent disabled:opacity-50"
                  />
                </div>

                {/* SMS Consent */}
                {phone.trim() && (
                  <div className="mt-3 p-3 bg-surface rounded-xl border border-border-subtle">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={smsConsent}
                        onChange={(e) => setSmsConsent(e.target.checked)}
                        disabled={step === "saving"}
                        className="mt-0.5 w-4 h-4 rounded border-border-subtle bg-surface accent-accent"
                      />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <MessageSquare className="w-3.5 h-3.5 text-accent" />
                          <span className="text-xs font-medium text-offwhite">Enable SMS Alerts</span>
                        </div>
                        <p className="text-[10px] text-carbon-light mt-1 leading-relaxed">
                          By checking this box, borrower consents to receive automated insurance
                          verification and compliance text messages at the phone number provided.
                          Message frequency varies. Msg &amp; data rates may apply.
                          Reply STOP to cancel, HELP for help.
                        </p>
                      </div>
                    </label>
                  </div>
                )}
              </div>

              {/* Vehicle Info */}
              <div>
                <p className="text-xs font-medium text-carbon-light uppercase tracking-wider mb-3">
                  Vehicle Information
                </p>
                <div>
                  <label className="text-xs text-carbon-light mb-1 block">
                    VIN <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={vin}
                      onChange={(e) => handleVinChange(e.target.value)}
                      placeholder="1HGCM82633A004352"
                      maxLength={17}
                      disabled={step === "saving"}
                      className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite placeholder:text-carbon-light/50 focus:outline-none focus:border-accent font-mono disabled:opacity-50"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                      {vinDecoding && (
                        <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
                      )}
                      {vinDecoded && (
                        <div className="flex items-center gap-1 text-green-400">
                          <Car className="w-3.5 h-3.5" />
                          <span className="text-[10px]">Decoded</span>
                        </div>
                      )}
                      <span className="text-[10px] text-carbon-light">
                        {vin.length}/17
                      </span>
                    </div>
                  </div>
                </div>
                {vinDecoded && (
                  <div className="mt-2 px-3 py-2 bg-green-500/5 border border-green-500/20 rounded-lg">
                    <p className="text-xs text-green-300">
                      <Car className="w-3 h-3 inline mr-1" />
                      {year} {make} {model}
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div>
                    <label className="text-xs text-carbon-light mb-1 block">
                      Make
                    </label>
                    <input
                      type="text"
                      value={make}
                      onChange={(e) => setMake(e.target.value)}
                      placeholder="Honda"
                      disabled={step === "saving"}
                      className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite placeholder:text-carbon-light/50 focus:outline-none focus:border-accent disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-carbon-light mb-1 block">
                      Model
                    </label>
                    <input
                      type="text"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="Accord"
                      disabled={step === "saving"}
                      className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite placeholder:text-carbon-light/50 focus:outline-none focus:border-accent disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-carbon-light mb-1 block">
                      Year
                    </label>
                    <input
                      type="text"
                      value={year}
                      onChange={(e) => setYear(e.target.value)}
                      placeholder="2024"
                      maxLength={4}
                      disabled={step === "saving"}
                      className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite placeholder:text-carbon-light/50 focus:outline-none focus:border-accent disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SUCCESS STEP — "What's next?" chooser */}
          {step === "success" && result && (
            <div className="space-y-5 py-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center flex-shrink-0">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="text-sm text-offwhite font-medium">
                    {borrowerName} has been {result.isNewBorrower ? "added" : "updated"}
                  </p>
                  <p className="text-xs text-carbon-light">
                    {vehicleLabel}{loanNumber.trim() ? ` \u00b7 Loan #${loanNumber}` : ""}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-carbon-light uppercase tracking-wider mb-3">
                  What would you like to do next?
                </p>
                <div className="space-y-2">
                  {/* Option A: Request from borrower */}
                  <button
                    onClick={handleSendRequest}
                    className="w-full flex items-start gap-3 p-3 rounded-xl bg-surface border border-border-subtle hover:border-accent/40 transition-colors text-left group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Send className="w-4 h-4 text-accent" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-offwhite group-hover:text-accent transition-colors">
                        Request info from borrower
                      </p>
                      <p className="text-[11px] text-carbon-light mt-0.5">
                        Send a magic link via email{phone.trim() ? " & SMS" : ""} so the borrower can provide their insurance details
                      </p>
                    </div>
                  </button>

                  {/* Option B: Dealer has info */}
                  <button
                    onClick={() => setStep("manual-insurance")}
                    className="w-full flex items-start gap-3 p-3 rounded-xl bg-surface border border-border-subtle hover:border-accent/40 transition-colors text-left group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <FileText className="w-4 h-4 text-green-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-offwhite group-hover:text-accent transition-colors">
                        I have the insurance info
                      </p>
                      <p className="text-[11px] text-carbon-light mt-0.5">
                        Enter carrier, policy number, or upload an insurance card on behalf of the borrower
                      </p>
                    </div>
                  </button>

                  {/* Option C: Skip */}
                  <button
                    onClick={handleDone}
                    className="w-full flex items-start gap-3 p-3 rounded-xl bg-surface border border-border-subtle hover:border-border-subtle/60 transition-colors text-left group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center flex-shrink-0 mt-0.5 border border-border-subtle">
                      <X className="w-4 h-4 text-carbon-light" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-carbon-light group-hover:text-offwhite transition-colors">
                        Skip for now
                      </p>
                      <p className="text-[11px] text-carbon-light mt-0.5">
                        You can add insurance info or send a request later from the borrower detail panel
                      </p>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* MANUAL INSURANCE STEP */}
          {step === "manual-insurance" && result && (
            <div className="space-y-4">
              {error && (
                <div className="px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-xl">
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}

              <p className="text-xs font-medium text-carbon-light uppercase tracking-wider mb-3">
                Insurance Details for {borrowerName}
              </p>

              <div>
                <label className="text-xs text-carbon-light mb-1 block">Insurance Carrier</label>
                <input
                  type="text"
                  value={insProvider}
                  onChange={(e) => setInsProvider(e.target.value)}
                  placeholder="e.g. Progressive, State Farm, GEICO"
                  className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite placeholder:text-carbon-light/50 focus:outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="text-xs text-carbon-light mb-1 block">Policy Number</label>
                <input
                  type="text"
                  value={insPolicyNum}
                  onChange={(e) => setInsPolicyNum(e.target.value)}
                  placeholder="e.g. 864861547"
                  className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite placeholder:text-carbon-light/50 focus:outline-none focus:border-accent font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-carbon-light mb-1 block">Insurance Card (optional)</label>
                <div className="relative">
                  {insCardBase64 ? (
                    <div className="flex items-center gap-2 px-3 py-2 bg-green-500/5 border border-green-500/20 rounded-lg">
                      <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                      <span className="text-xs text-green-300 truncate">{insCardName}</span>
                      <button
                        onClick={() => { setInsCardBase64(null); setInsCardName(null); }}
                        className="ml-auto text-carbon-light hover:text-red-400"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 px-3 py-2.5 bg-surface border border-border-subtle border-dashed rounded-lg cursor-pointer hover:border-accent/40 transition-colors">
                      <Upload className="w-4 h-4 text-carbon-light" />
                      <span className="text-xs text-carbon-light">Upload photo or PDF of insurance card</span>
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={handleCardUpload}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
                <p className="text-[10px] text-carbon-light mt-1">
                  If you upload a card, we&apos;ll automatically extract the details using AI
                </p>
              </div>
            </div>
          )}

          {/* SENDING REQUEST / LOADING */}
          {step === "sending-request" && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 className="w-8 h-8 text-accent animate-spin" />
              <p className="text-sm text-carbon-light">Processing...</p>
            </div>
          )}

          {/* DONE STEP — final confirmation */}
          {step === "done" && result && (
            <div className="space-y-5 text-center py-4">
              <div className="flex justify-center">
                <div className="w-14 h-14 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                  <CheckCircle className="w-7 h-7 text-green-400" />
                </div>
              </div>
              <div>
                <p className="text-sm text-offwhite font-medium">
                  {borrowerName} has been {result.isNewBorrower ? "added" : "updated"}
                </p>
                <p className="text-xs text-carbon-light mt-1">
                  {vehicleLabel}{loanNumber.trim() ? ` \u00b7 Loan #${loanNumber}` : ""}
                </p>
              </div>

              {intakeResult && (
                <div className="bg-surface rounded-xl border border-green-500/20 p-4">
                  <p className="text-xs text-green-300">
                    <CheckCircle className="w-3 h-3 inline mr-1" />
                    Insurance request sent via {intakeResult.deliveryMethod === "both" ? "email & SMS" : intakeResult.deliveryMethod}
                  </p>
                </div>
              )}

              {dealerInsuranceResult && (
                <div className="bg-surface rounded-xl border border-green-500/20 p-4">
                  <p className="text-xs text-green-300">
                    <CheckCircle className="w-3 h-3 inline mr-1" />
                    Insurance info saved
                    {dealerInsuranceResult.ocrExtracted ? " \u2014 details extracted from card" : ""}
                  </p>
                  {dealerInsuranceResult.provider && (
                    <p className="text-[11px] text-carbon-light mt-1">
                      {dealerInsuranceResult.provider}
                      {dealerInsuranceResult.policyNumber ? ` \u00b7 #${dealerInsuranceResult.policyNumber}` : ""}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-subtle flex items-center justify-end gap-3">
          {step === "form" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={handleClose}
                className="bg-transparent border-border-subtle text-carbon-light hover:text-offwhite"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="bg-accent hover:bg-accent-hover text-white border-0 disabled:opacity-50"
              >
                <UserPlus className="w-3.5 h-3.5 mr-1.5" />
                Add Borrower
              </Button>
            </>
          )}

          {step === "saving" && (
            <Button
              size="sm"
              disabled
              className="bg-accent text-white border-0 opacity-70"
            >
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              Saving...
            </Button>
          )}

          {step === "manual-insurance" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setStep("success"); setError(null); }}
                className="bg-transparent border-border-subtle text-carbon-light hover:text-offwhite"
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                Back
              </Button>
              <Button
                size="sm"
                onClick={handleDealerSubmitInsurance}
                disabled={!insProvider.trim() && !insPolicyNum.trim() && !insCardBase64}
                className="bg-accent hover:bg-accent-hover text-white border-0 disabled:opacity-50"
              >
                <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
                Save Insurance
              </Button>
            </>
          )}

          {step === "done" && (
            <Button
              size="sm"
              onClick={handleDone}
              className="bg-accent hover:bg-accent-hover text-white border-0"
            >
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
