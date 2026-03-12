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
        <Button variant="outline" size="sm">
          Send Link
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send Verification Link</DialogTitle>
          <DialogDescription>
            Send an insurance verification link to {borrowerName} for their {vehicleLabel}.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <div>
              <Label>Send via</Label>
              <div className="mt-2 flex gap-2">
                <Button
                  variant={channel === "EMAIL" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setChannel("EMAIL")}
                >
                  Email
                </Button>
                <Button
                  variant={channel === "SMS" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setChannel("SMS")}
                >
                  SMS
                </Button>
              </div>
            </div>

            <div>
              <Label>Recipient</Label>
              <Input
                value={channel === "EMAIL" ? borrowerEmail : borrowerPhone}
                disabled
                className="mt-1"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            <Button onClick={handleSend} disabled={loading} className="w-full">
              {loading ? "Generating link..." : "Generate & Log Verification Link"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md bg-green-50 p-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-green-600 text-green-600">
                  Link Generated
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Notification logged for {result.recipient}
                </span>
              </div>
            </div>

            <div>
              <Label>Verification Link</Label>
              <div className="mt-1 flex gap-2">
                <Input value={result.invitationUrl} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Share this link with the borrower to verify their insurance.
              </p>
            </div>

            <Button variant="outline" onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
