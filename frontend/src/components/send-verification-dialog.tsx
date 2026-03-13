"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { callSendVerificationLink } from "@/lib/api";

interface SendVerificationDialogProps {
  organizationId: string;
  borrowerId: string;
  vehicleId: string;
  borrowerName: string;
  borrowerEmail: string;
  borrowerPhone: string;
  vehicleLabel: string;
}

export function SendVerificationDialog({
  organizationId,
  borrowerId,
  vehicleId,
  borrowerName,
  borrowerEmail,
  borrowerPhone,
  vehicleLabel,
}: SendVerificationDialogProps) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<"EMAIL" | "SMS">("EMAIL");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    invitationUrl: string;
    recipient: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSend = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await callSendVerificationLink({
        organizationId,
        borrowerId,
        vehicleId,
        channel,
      });
      setResult({
        invitationUrl: response.data.invitationUrl,
        recipient: response.data.recipient,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send verification link.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.invitationUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    setOpen(false);
    setResult(null);
    setError(null);
    setCopied(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="border-border-subtle text-carbon-light hover:text-offwhite hover:bg-surface">
          Send Link
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card-bg border-border-subtle text-offwhite">
        <DialogHeader>
          <DialogTitle className="text-offwhite">Send Verification Link</DialogTitle>
          <DialogDescription className="text-carbon-light">
            Send an insurance verification link to {borrowerName} for their {vehicleLabel}.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <div>
              <Label className="text-carbon-light">Send via</Label>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => setChannel("EMAIL")}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${channel === "EMAIL" ? "bg-accent/15 text-accent" : "bg-surface text-carbon-light hover:text-offwhite"}`}
                >
                  Email
                </button>
                <button
                  onClick={() => setChannel("SMS")}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${channel === "SMS" ? "bg-accent/15 text-accent" : "bg-surface text-carbon-light hover:text-offwhite"}`}
                >
                  SMS
                </button>
              </div>
            </div>

            <div>
              <Label className="text-carbon-light">Recipient</Label>
              <Input
                value={channel === "EMAIL" ? borrowerEmail : borrowerPhone}
                disabled
                className="mt-1 bg-surface border-border-subtle text-offwhite"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}

            <Button onClick={handleSend} disabled={loading} className="w-full bg-accent hover:bg-accent-hover text-white">
              {loading ? "Generating link..." : "Generate & Log Verification Link"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md bg-green-500/10 border border-green-500/20 p-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-green-500/30 text-green-400">
                  Link Generated
                </Badge>
                <span className="text-sm text-carbon-light">
                  Notification logged for {result.recipient}
                </span>
              </div>
            </div>

            <div>
              <Label className="text-carbon-light">Verification Link</Label>
              <div className="mt-1 flex gap-2">
                <Input value={result.invitationUrl} readOnly className="font-mono text-xs bg-surface border-border-subtle text-offwhite" />
                <Button variant="outline" size="sm" onClick={handleCopy} className="border-border-subtle text-carbon-light hover:text-offwhite hover:bg-surface">
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
              <p className="mt-1 text-xs text-carbon-light">
                Share this link with the borrower to verify their insurance.
              </p>
            </div>

            <Button variant="outline" onClick={handleClose} className="w-full border-border-subtle text-carbon-light hover:text-offwhite hover:bg-surface">
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
