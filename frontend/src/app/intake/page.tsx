"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { callGetIntakeInfo, callSubmitBorrowerIntake, type IntakeInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Upload, CheckCircle, AlertTriangle, ShieldCheck } from "lucide-react";

const COMMON_CARRIERS = [
  "State Farm", "GEICO", "Progressive", "Allstate", "USAA",
  "Liberty Mutual", "Nationwide", "Farmers", "American Family",
  "Travelers", "Erie Insurance", "National General", "The Hartford",
  "Auto-Owners", "Country Financial", "Shelter Insurance",
];

type PageState = "loading" | "form" | "submitting" | "success" | "error" | "expired" | "completed";

export default function IntakePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-b from-zinc-950 to-zinc-900 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
        </div>
      }
    >
      <IntakePageInner />
    </Suspense>
  );
}

function IntakePageInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [pageState, setPageState] = useState<PageState>("loading");
  const [info, setInfo] = useState<IntakeInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // Form fields
  const [insuranceProvider, setInsuranceProvider] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [cardFile, setCardFile] = useState<File | null>(null);
  const [cardPreview, setCardPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) {
      setErrorMsg("Invalid link. Please use the link from your text message.");
      setPageState("error");
      return;
    }

    callGetIntakeInfo({ token })
      .then((res) => {
        setInfo(res.data);
        if (res.data.status === "EXPIRED") {
          setPageState("expired");
        } else if (res.data.status === "COMPLETED") {
          setPageState("completed");
        } else {
          setPageState("form");
        }
      })
      .catch(() => {
        setErrorMsg("This link is invalid or has expired. Please contact your dealership for a new link.");
        setPageState("error");
      });
  }, [token]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file && file.size > 10 * 1024 * 1024) {
      setErrorMsg("File must be under 10MB");
      return;
    }
    setCardFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setCardPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setCardPreview(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    const hasTextFields = insuranceProvider.trim() && policyNumber.trim();
    const hasCard = !!cardFile;

    if (!hasTextFields && !hasCard) {
      setErrorMsg("Please enter your insurance information or upload a photo of your insurance card.");
      return;
    }

    setPageState("submitting");
    setErrorMsg("");

    try {
      let insuranceCardBase64: string | undefined;
      if (cardFile) {
        insuranceCardBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Strip the data URL prefix (e.g. "data:image/jpeg;base64,")
            const base64 = result.split(",")[1];
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(cardFile);
        });
      }

      await callSubmitBorrowerIntake({
        token,
        insuranceProvider: insuranceProvider.trim() || undefined,
        policyNumber: policyNumber.trim() || undefined,
        insuranceCardBase64,
      });

      setPageState("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setPageState("form");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 to-zinc-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 mb-2">
            <ShieldCheck className="w-6 h-6 text-blue-400" />
            <span className="text-lg font-semibold text-white">Auto Lien Tracker</span>
          </div>
          <p className="text-sm text-zinc-400">Insurance Verification</p>
        </div>

        {pageState === "loading" && (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
            </CardContent>
          </Card>
        )}

        {pageState === "error" && (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="text-center py-12">
              <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <p className="text-zinc-300">{errorMsg}</p>
            </CardContent>
          </Card>
        )}

        {pageState === "expired" && (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="text-center py-12">
              <AlertTriangle className="w-12 h-12 text-yellow-400 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-white mb-2">Link Expired</h2>
              <p className="text-zinc-400">This link has expired. Please contact your dealership for a new one.</p>
            </CardContent>
          </Card>
        )}

        {pageState === "completed" && (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="text-center py-12">
              <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-white mb-2">Already Submitted</h2>
              <p className="text-zinc-400">Your insurance information has already been received. Thank you!</p>
            </CardContent>
          </Card>
        )}

        {pageState === "success" && (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="text-center py-12">
              <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-white mb-2">Thank You!</h2>
              <p className="text-zinc-400">
                Your insurance information has been submitted successfully.
                You can close this page.
              </p>
            </CardContent>
          </Card>
        )}

        {(pageState === "form" || pageState === "submitting") && info && (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-white text-lg">Insurance Information Needed</CardTitle>
              <CardDescription className="text-zinc-400">
                Hi {info.borrowerFirstName}, <strong className="text-zinc-300">{info.dealershipName}</strong> needs
                your insurance details for your <strong className="text-zinc-300">{info.vehicleLabel}</strong>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Insurance Provider */}
                <div className="space-y-2">
                  <Label htmlFor="provider" className="text-zinc-300">Insurance Company</Label>
                  <Input
                    id="provider"
                    list="carriers"
                    placeholder="e.g. State Farm, GEICO..."
                    value={insuranceProvider}
                    onChange={(e) => setInsuranceProvider(e.target.value)}
                    className="bg-zinc-800 border-zinc-700 text-white"
                    disabled={pageState === "submitting"}
                  />
                  <datalist id="carriers">
                    {COMMON_CARRIERS.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>

                {/* Policy Number */}
                <div className="space-y-2">
                  <Label htmlFor="policyNumber" className="text-zinc-300">Policy Number</Label>
                  <Input
                    id="policyNumber"
                    placeholder="Enter your policy number"
                    value={policyNumber}
                    onChange={(e) => setPolicyNumber(e.target.value)}
                    className="bg-zinc-800 border-zinc-700 text-white"
                    disabled={pageState === "submitting"}
                  />
                </div>

                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-zinc-700" />
                  <span className="text-xs text-zinc-500 uppercase">or upload a photo</span>
                  <div className="h-px flex-1 bg-zinc-700" />
                </div>

                {/* Insurance Card Upload */}
                <div className="space-y-2">
                  <Label className="text-zinc-300">Insurance Card Photo</Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf"
                    capture="environment"
                    onChange={handleFileChange}
                    className="hidden"
                    disabled={pageState === "submitting"}
                  />
                  {cardPreview ? (
                    <div className="flex items-center justify-between gap-2 p-3 rounded-lg border border-zinc-700 bg-zinc-800/50">
                      <div className="flex items-center gap-2 min-w-0">
                        {cardFile?.type === "application/pdf" ? (
                          <span className="text-sm text-zinc-300 truncate">{cardFile.name}</span>
                        ) : (
                          <img
                            src={cardPreview}
                            alt="Insurance card preview"
                            className="h-12 w-auto rounded border border-zinc-700"
                          />
                        )}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setCardFile(null);
                          setCardPreview(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        className="shrink-0 border-zinc-600 text-zinc-300 text-xs"
                        disabled={pageState === "submitting"}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full h-24 border-dashed border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800"
                      disabled={pageState === "submitting"}
                    >
                      <Upload className="w-5 h-5 mr-2" />
                      Take Photo or Upload
                    </Button>
                  )}
                </div>

                {errorMsg && (
                  <p className="text-sm text-red-400">{errorMsg}</p>
                )}

                <Button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white"
                  disabled={pageState === "submitting"}
                >
                  {pageState === "submitting" ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Submit Insurance Info"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-zinc-600 mt-4">
          Secured by Auto Lien Tracker &middot; Your info is encrypted
        </p>
      </div>
    </div>
  );
}
