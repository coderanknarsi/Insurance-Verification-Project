"use client";

import { useState, useRef, useCallback } from "react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import {
  Upload,
  FileSpreadsheet,
  X,
  ChevronRight,
  ChevronLeft,
  Download,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { callBulkImportDeals } from "@/lib/api";
import type { CsvRow, BulkImportResult } from "@/lib/api";

interface ImportDialogProps {
  organizationId: string;
  open: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

const REQUIRED_FIELDS: { key: keyof CsvRow; label: string; required: boolean }[] = [
  { key: "firstName", label: "First Name", required: true },
  { key: "lastName", label: "Last Name", required: true },
  { key: "vin", label: "VIN", required: true },
  { key: "email", label: "Email", required: false },
  { key: "phone", label: "Phone", required: false },
  { key: "loanNumber", label: "Loan Number", required: false },
  { key: "make", label: "Make", required: false },
  { key: "model", label: "Model", required: false },
  { key: "year", label: "Year", required: false },
];

// Map common CSV header variations to our field keys
const HEADER_ALIASES: Record<string, keyof CsvRow> = {
  "first name": "firstName",
  first_name: "firstName",
  firstname: "firstName",
  fname: "firstName",
  "f name": "firstName",
  "given name": "firstName",
  given_name: "firstName",
  "last name": "lastName",
  last_name: "lastName",
  lastname: "lastName",
  lname: "lastName",
  "l name": "lastName",
  surname: "lastName",
  "family name": "lastName",
  family_name: "lastName",
  email: "email",
  "email address": "email",
  email_address: "email",
  emailaddress: "email",
  "e-mail": "email",
  "e mail": "email",
  phone: "phone",
  "phone number": "phone",
  phone_number: "phone",
  phonenumber: "phone",
  telephone: "phone",
  tel: "phone",
  mobile: "phone",
  "cell phone": "phone",
  cell: "phone",
  "loan number": "loanNumber",
  loan_number: "loanNumber",
  loannumber: "loanNumber",
  "loan #": "loanNumber",
  "loan#": "loanNumber",
  loan_no: "loanNumber",
  "loan id": "loanNumber",
  loan_id: "loanNumber",
  loanid: "loanNumber",
  "account number": "loanNumber",
  account_number: "loanNumber",
  "acct #": "loanNumber",
  "account #": "loanNumber",
  vin: "vin",
  "vin #": "vin",
  "vin#": "vin",
  "vin number": "vin",
  vin_number: "vin",
  "vehicle identification number": "vin",
  make: "make",
  "vehicle make": "make",
  vehicle_make: "make",
  manufacturer: "make",
  brand: "make",
  model: "model",
  "vehicle model": "model",
  vehicle_model: "model",
  year: "year",
  "vehicle year": "year",
  vehicle_year: "year",
  "model year": "year",
  model_year: "year",
  yr: "year",
};

const CAR_MAKES = new Set([
  "acura","alfa romeo","aston martin","audi","bentley","bmw","buick",
  "cadillac","chevrolet","chevy","chrysler","dodge","ferrari","fiat",
  "ford","genesis","gmc","honda","hyundai","infiniti","jaguar","jeep",
  "kia","lamborghini","land rover","lexus","lincoln","lucid","maserati",
  "mazda","mclaren","mercedes","mercedes-benz","mini","mitsubishi",
  "nissan","polestar","porsche","ram","rivian","rolls-royce","subaru",
  "suzuki","tesla","toyota","volkswagen","volvo",
]);

/** Analyze actual cell values to detect which CsvRow field a column likely represents. */
function detectColumnContent(
  headers: string[],
  rows: Record<string, string>[]
): Record<string, keyof CsvRow | ""> {
  const sampleRows = rows.slice(0, Math.min(20, rows.length));

  // Score each (column, field) pair
  const scores: Record<string, Partial<Record<keyof CsvRow, number>>> = {};

  for (const header of headers) {
    scores[header] = {};
    const vals = sampleRows.map((r) => (r[header] ?? "").trim()).filter(Boolean);
    if (vals.length === 0) continue;

    // Email: contains @
    const emailHits = vals.filter((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)).length;
    if (emailHits > vals.length * 0.5) scores[header].email = emailHits / vals.length;

    // VIN: exactly 17 alphanumeric chars
    const vinHits = vals.filter((v) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(v)).length;
    if (vinHits > vals.length * 0.5) scores[header].vin = vinHits / vals.length;

    // Phone: mostly digits, 10-11 digits when stripped
    const phoneHits = vals.filter((v) => {
      const digits = v.replace(/\D/g, "");
      return digits.length >= 10 && digits.length <= 11 && /[\d\-().\s+]/.test(v);
    }).length;
    if (phoneHits > vals.length * 0.5) scores[header].phone = phoneHits / vals.length;

    // Year: 4-digit number between 1980 and current+2
    const curYear = new Date().getFullYear();
    const yearHits = vals.filter((v) => {
      const n = parseInt(v, 10);
      return /^\d{4}$/.test(v.trim()) && n >= 1980 && n <= curYear + 2;
    }).length;
    if (yearHits > vals.length * 0.5) scores[header].year = yearHits / vals.length;

    // Make: matches known car manufacturers
    const makeHits = vals.filter((v) => CAR_MAKES.has(v.toLowerCase())).length;
    if (makeHits > vals.length * 0.3) scores[header].make = makeHits / vals.length;

    // Loan number: alphanumeric with dashes/dots, typically 5-20 chars, NOT pure email/VIN
    const loanHits = vals.filter((v) => {
      if (v.includes("@")) return false;
      if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(v)) return false;
      return /^[A-Z0-9][A-Z0-9\-._/]{3,19}$/i.test(v);
    }).length;
    if (loanHits > vals.length * 0.4) scores[header].loanNumber = (loanHits / vals.length) * 0.8;

    // Name fields: mostly alphabetic words, short length
    const nameHits = vals.filter(
      (v) => /^[A-Za-z][A-Za-z'\-. ]{0,30}$/.test(v) && v.length <= 30
    ).length;
    if (nameHits > vals.length * 0.6) {
      scores[header].firstName = (nameHits / vals.length) * 0.3;
      scores[header].lastName = (nameHits / vals.length) * 0.3;
    }

    // Model: short text, not matching makes, not numbers
    const modelHits = vals.filter(
      (v) => v.length >= 2 && v.length <= 30 && !CAR_MAKES.has(v.toLowerCase()) && !/^\d{4}$/.test(v)
    ).length;
    if (modelHits > vals.length * 0.5) {
      scores[header].model = (modelHits / vals.length) * 0.25;
    }
  }

  // Greedy assignment: assign highest-scoring (column, field) pairs, no duplicates
  const result: Record<string, keyof CsvRow | ""> = {};
  for (const h of headers) result[h] = "";

  const usedFields = new Set<keyof CsvRow>();
  const usedHeaders = new Set<string>();

  // First pass: header alias matches (high confidence)
  for (const header of headers) {
    const normalized = header.toLowerCase().trim();
    if (HEADER_ALIASES[normalized] && !usedFields.has(HEADER_ALIASES[normalized])) {
      result[header] = HEADER_ALIASES[normalized];
      usedFields.add(HEADER_ALIASES[normalized]);
      usedHeaders.add(header);
    }
  }

  // Second pass: content-based detection for unmapped columns
  const pairs: { header: string; field: keyof CsvRow; score: number }[] = [];
  for (const header of headers) {
    if (usedHeaders.has(header)) continue;
    for (const [field, score] of Object.entries(scores[header] ?? {})) {
      if (score && !usedFields.has(field as keyof CsvRow)) {
        pairs.push({ header, field: field as keyof CsvRow, score });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  for (const { header, field } of pairs) {
    if (usedFields.has(field) || usedHeaders.has(header)) continue;
    result[header] = field;
    usedFields.add(field);
    usedHeaders.add(header);
  }

  return result;
}

function countMappedFields(mapping: Record<string, keyof CsvRow | "">): number {
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  return mapped.size;
}

type Step = "upload" | "mapping" | "validation" | "importing" | "results";

function downloadTemplate() {
  const headers = "firstName,lastName,email,phone,loanNumber,vin,make,model,year";
  const sample =
    "John,Smith,john.smith@email.com,555-123-4567,LN-2024-001,1HGCM82633A004352,Honda,Accord,2023";
  const csv = `${headers}\n${sample}`;
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportDialog({ organizationId, open, onClose, onImportComplete }: ImportDialogProps) {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, keyof CsvRow | "">>({}); 
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [mappedRows, setMappedRows] = useState<CsvRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("upload");
    setFileName(null);
    setRawHeaders([]);
    setRawRows([]);
    setMapping({});
    setValidationErrors([]);
    setValidationWarnings([]);
    setMappedRows([]);
    setImporting(false);
    setImportResult(null);
    setImportError(null);
    setShowErrors(false);
    setDragOver(false);
    setSmsConsent(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportError("Please select a .csv file");
      return;
    }
    setImportError(null);
    setFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields ?? [];
        const rows = results.data as Record<string, string>[];

        if (rows.length === 0) {
          setImportError("CSV file is empty");
          return;
        }
        if (rows.length > 500) {
          setImportError(`CSV has ${rows.length} rows. Maximum is 500 per import.`);
          return;
        }

        setRawHeaders(headers);
        setRawRows(rows);

        // Smart auto-detect: header aliases + content analysis
        const autoMapping = detectColumnContent(headers, rows);
        setMapping(autoMapping);

        // Skip mapping step if all 9 fields are auto-detected
        if (countMappedFields(autoMapping) >= REQUIRED_FIELDS.length) {
          setStep("mapping"); // still go to mapping so user can verify
        } else {
          setStep("mapping");
        }
      },
      error: () => {
        setImportError("Failed to parse CSV file");
      },
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  // Check if all required fields are mapped
  // Only the truly required fields need mapping to proceed
  const allFieldsMapped = REQUIRED_FIELDS
    .filter((f) => f.required)
    .every((f) => Object.values(mapping).includes(f.key));

  const proceedToValidation = () => {
    // Map raw rows to CsvRow using the mapping
    const rows: CsvRow[] = rawRows.map((raw) => {
      const row: Partial<CsvRow> = {};
      for (const [csvHeader, fieldKey] of Object.entries(mapping)) {
        if (fieldKey) {
          const val = raw[csvHeader]?.trim() ?? "";
          if (fieldKey === "year") {
            (row as Record<string, unknown>)[fieldKey] = parseInt(val, 10) || 0;
          } else {
            (row as Record<string, unknown>)[fieldKey] = val;
          }
        }
      }
      return row as CsvRow;
    });

    // Validate — only hard-fail on truly required fields
    const errors: string[] = [];
    const warnings: string[] = [];
    rows.forEach((row, i) => {
      const rowNum = i + 1;
      if (!row.firstName || !row.lastName) errors.push(`Row ${rowNum}: Missing name`);
      if (!row.vin) errors.push(`Row ${rowNum}: Missing VIN`);
      if (!row.email && !row.phone) errors.push(`Row ${rowNum}: Missing email or phone — at least one is required`);
      // Warnings for missing optional fields
      if (!row.make && !row.model) warnings.push(`Row ${rowNum}: No make/model — will attempt VIN decode`);
    });

    setMappedRows(rows);
    setValidationErrors(errors);
    setValidationWarnings(warnings);
    setStep("validation");
  };

  const handleImport = async () => {
    setStep("importing");
    setImporting(true);
    setImportError(null);

    try {
      const result = await callBulkImportDeals({
        organizationId,
        rows: mappedRows,
        ...(smsConsent && { smsConsent: true }),
      });
      setImportResult(result.data);
      setStep("results");
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
      setStep("validation");
    } finally {
      setImporting(false);
    }
  };

  const handleDone = () => {
    onImportComplete();
    handleClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-card-bg border border-border-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-5 h-5 text-accent" />
            <h2 className="text-base font-semibold text-offwhite">Import Customers</h2>
          </div>
          <button onClick={handleClose} className="text-carbon-light hover:text-offwhite transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-6 py-3 border-b border-border-subtle flex items-center gap-2">
          {(["upload", "mapping", "validation", "results"] as const).map((s, i) => {
            const labels = ["Upload", "Map Columns", "Review", "Results"];
            const isActive = step === s || (step === "importing" && s === "results");
            const stepOrder = ["upload", "mapping", "validation", "results"];
            const currentIdx = step === "importing" ? 3 : stepOrder.indexOf(step);
            const isPast = i < currentIdx;
            return (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && <div className={`w-6 h-px ${isPast ? "bg-accent" : "bg-border-subtle"}`} />}
                <div className="flex items-center gap-1.5">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      isPast
                        ? "bg-accent text-white"
                        : isActive
                          ? "bg-accent/20 text-accent border border-accent"
                          : "bg-surface text-carbon-light"
                    }`}
                  >
                    {isPast ? "✓" : i + 1}
                  </div>
                  <span className={`text-xs ${isActive || isPast ? "text-offwhite" : "text-carbon-light"}`}>
                    {labels[i]}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-6">
          {importError && step !== "results" && (
            <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{importError}</p>
            </div>
          )}

          {/* STEP 1: Upload */}
          {step === "upload" && (
            <div className="space-y-4">
              <div
                className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
                  dragOver ? "border-accent bg-accent/5" : "border-border-subtle hover:border-accent/40"
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <Upload className="w-10 h-10 text-carbon-light mx-auto mb-3" />
                <p className="text-sm text-offwhite font-medium mb-1">
                  Drag & drop your CSV file here
                </p>
                <p className="text-xs text-carbon-light mb-4">or click to browse</p>
                <Button
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-accent hover:bg-accent-hover text-white border-0"
                >
                  Choose File
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileInput}
                  className="hidden"
                />
              </div>
              <div className="flex items-center justify-between bg-surface rounded-xl px-4 py-3">
                <div>
                  <p className="text-xs text-offwhite font-medium">Need a template?</p>
                  <p className="text-[11px] text-carbon-light">
                    Download a CSV with the correct column headers
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={downloadTemplate}
                  className="bg-transparent border-border-subtle text-carbon-light hover:text-offwhite hover:bg-white/[0.04]"
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  Template
                </Button>
              </div>
              <p className="text-[11px] text-carbon-light text-center">
                Maximum 500 rows per import &middot; Required: Name, Loan #, VIN &middot; Optional: Email, Phone, Make, Model, Year
              </p>
            </div>
          )}

          {/* STEP 2: Column Mapping */}
          {step === "mapping" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-offwhite font-medium">{fileName}</p>
                  <p className="text-xs text-carbon-light">{rawRows.length} rows detected</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={reset}
                  className="bg-transparent border-border-subtle text-carbon-light hover:text-offwhite"
                >
                  Re-upload
                </Button>
              </div>

              {/* Auto-detection banner */}
              {(() => {
                const mapped = countMappedFields(mapping);
                const requiredCount = REQUIRED_FIELDS.filter(f => f.required).length;
                const requiredMapped = REQUIRED_FIELDS.filter(f => f.required && Object.values(mapping).includes(f.key)).length;
                if (mapped === REQUIRED_FIELDS.length) {
                  return (
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-green-500/10 border border-green-500/30 rounded-xl">
                      <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                      <p className="text-xs text-green-300">
                        All {REQUIRED_FIELDS.length} fields were auto-detected. Verify the mapping below then continue.
                      </p>
                    </div>
                  );
                }
                if (requiredMapped === requiredCount && mapped < REQUIRED_FIELDS.length) {
                  return (
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-green-500/10 border border-green-500/30 rounded-xl">
                      <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                      <p className="text-xs text-green-300">
                        All required fields detected ({mapped} of {REQUIRED_FIELDS.length} total). Optional fields can be mapped below or left empty.
                      </p>
                    </div>
                  );
                }
                if (mapped > 0) {
                  return (
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                      <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />
                      <p className="text-xs text-yellow-300">
                        {mapped} of {REQUIRED_FIELDS.length} fields auto-detected. Map the required fields below.
                      </p>
                    </div>
                  );
                }
                return null;
              })()}

              <div className="bg-surface rounded-xl border border-border-subtle overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border-subtle">
                  <p className="text-xs font-medium text-offwhite">Map your CSV columns to borrower fields</p>
                </div>
                <div className="divide-y divide-border-subtle">
                  {REQUIRED_FIELDS.map((field) => {
                    const mappedHeader = Object.entries(mapping).find(
                      ([, v]) => v === field.key
                    )?.[0];
                    return (
                      <div key={field.key} className="flex items-center justify-between px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {mappedHeader ? (
                            <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                          ) : field.required ? (
                            <XCircle className="w-3.5 h-3.5 text-red-400" />
                          ) : (
                            <div className="w-3.5 h-3.5 rounded-full border border-border-subtle" />
                          )}
                          <span className="text-sm text-offwhite">{field.label}</span>
                          {field.required ? (
                            <span className="text-[9px] px-1.5 py-0.5 bg-red-500/15 text-red-400 rounded-full font-medium">Required</span>
                          ) : (field.key === "email" || field.key === "phone") ? (
                            <span className="text-[9px] px-1.5 py-0.5 bg-yellow-500/15 text-yellow-400 rounded-full font-medium">Need 1</span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.5 bg-surface text-carbon-light rounded-full">Optional</span>
                          )}
                        </div>
                        <select
                          value={mappedHeader ?? ""}
                          onChange={(e) => {
                            const newMapping = { ...mapping };
                            // Clear previous mapping for this field
                            for (const k of Object.keys(newMapping)) {
                              if (newMapping[k] === field.key) newMapping[k] = "";
                            }
                            if (e.target.value) {
                              newMapping[e.target.value] = field.key;
                            }
                            setMapping(newMapping);
                          }}
                          className="bg-card-bg border border-border-subtle rounded-lg px-3 py-1.5 text-xs text-offwhite w-48 focus:outline-none focus:border-accent"
                        >
                          <option value="">— Select column —</option>
                          {rawHeaders.map((h) => (
                            <option key={h} value={h} disabled={!!mapping[h] && mapping[h] !== field.key}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Preview */}
              {rawRows.length > 0 && (
                <div className="bg-surface rounded-xl border border-border-subtle overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border-subtle">
                    <p className="text-xs font-medium text-offwhite">Preview (first 3 rows)</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border-subtle">
                          {rawHeaders.slice(0, 9).map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-carbon-light font-mono">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rawRows.slice(0, 3).map((row, i) => (
                          <tr key={i} className="border-b border-border-subtle last:border-0">
                            {rawHeaders.slice(0, 9).map((h) => (
                              <td key={h} className="px-3 py-2 text-offwhite truncate max-w-[120px]">
                                {row[h] || "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: Validation */}
          {step === "validation" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-surface rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-offwhite">{mappedRows.length}</p>
                  <p className="text-xs text-carbon-light mt-1">Total customers</p>
                </div>
                <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-green-400">
                    {mappedRows.length - new Set(validationErrors.map((e) => e.match(/Row (\d+)/)?.[1])).size}
                  </p>
                  <p className="text-xs text-carbon-light mt-1">Valid customers</p>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-red-400">
                    {new Set(validationErrors.map((e) => e.match(/Row (\d+)/)?.[1])).size}
                  </p>
                  <p className="text-xs text-carbon-light mt-1">Customers with issues</p>
                </div>
              </div>

              {validationErrors.length > 0 && (
                <div className="bg-surface rounded-xl border border-border-subtle overflow-hidden">
                  <button
                    onClick={() => setShowErrors(!showErrors)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-yellow-400" />
                      <span className="text-sm text-yellow-300 font-medium">
                        {validationErrors.length} validation warning{validationErrors.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <ChevronRight
                      className={`w-4 h-4 text-carbon-light transition-transform ${showErrors ? "rotate-90" : ""}`}
                    />
                  </button>
                  {showErrors && (
                    <div className="border-t border-border-subtle px-4 py-3 max-h-40 overflow-y-auto space-y-1">
                      {validationErrors.map((err, i) => (
                        <p key={i} className="text-xs text-red-400">{err}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-carbon-light">
                {validationErrors.length > 0
                  ? "Customers with issues will be skipped during import. Valid customers will still be imported."
                  : "All rows passed validation. Ready to import."}
              </p>

              {/* SMS Consent */}
              {mappedRows.some((r) => r.phone) && (
                <div className="p-3 bg-surface rounded-xl border border-border-subtle">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={smsConsent}
                      onChange={(e) => setSmsConsent(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-border-subtle bg-surface accent-accent"
                    />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-accent" />
                        <span className="text-xs font-medium text-offwhite">
                          Enable SMS Alerts ({mappedRows.filter((r) => r.phone).length} customers with phone numbers)
                        </span>
                      </div>
                      <p className="text-[10px] text-carbon-light mt-1 leading-relaxed">
                        By checking this box, you confirm that all imported borrowers have provided
                        consent to receive automated insurance verification and compliance text
                        messages. Message frequency varies. Msg &amp; data rates may apply.
                        Recipients can reply STOP to cancel.
                      </p>
                    </div>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* STEP 4A: Importing */}
          {step === "importing" && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-10 h-10 text-accent animate-spin mb-4" />
              <p className="text-sm text-offwhite font-medium">Importing {mappedRows.length} customers...</p>
              <p className="text-xs text-carbon-light mt-1">This may take a moment</p>
            </div>
          )}

          {/* STEP 4B: Results */}
          {step === "results" && importResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3">
                <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                <div>
                  <p className="text-sm text-green-300 font-medium">Import complete</p>
                  <p className="text-xs text-green-400/70 mt-0.5">
                    Successfully processed {importResult.total} customers
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div className="bg-surface rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-offwhite">{importResult.total}</p>
                  <p className="text-xs text-carbon-light mt-1">Total</p>
                </div>
                <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-green-400">{importResult.created}</p>
                  <p className="text-xs text-carbon-light mt-1">Created</p>
                </div>
                <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-blue-400">{importResult.updated}</p>
                  <p className="text-xs text-carbon-light mt-1">Updated</p>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-red-400">{importResult.errors}</p>
                  <p className="text-xs text-carbon-light mt-1">Errors</p>
                </div>
              </div>

              {/* Warnings summary */}
              {(importResult.warnings ?? 0) > 0 && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                  <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />
                  <p className="text-xs text-yellow-300">
                    {importResult.warnings} warning{importResult.warnings !== 1 ? 's' : ''}: Some customers are missing contact info or vehicle details.
                    You can update them from the dashboard.
                  </p>
                </div>
              )}

              {/* Error details */}
              {importResult.errors > 0 && (
                <div className="bg-surface rounded-xl border border-border-subtle overflow-hidden">
                  <button
                    onClick={() => setShowErrors(!showErrors)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
                  >
                    <span className="text-sm text-red-400 font-medium">
                      {importResult.errors} customer{importResult.errors !== 1 ? "s" : ""} failed
                    </span>
                    <ChevronRight
                      className={`w-4 h-4 text-carbon-light transition-transform ${showErrors ? "rotate-90" : ""}`}
                    />
                  </button>
                  {showErrors && (
                    <div className="border-t border-border-subtle px-4 py-3 max-h-40 overflow-y-auto space-y-1.5">
                      {importResult.results
                        .filter((r) => r.status === "error")
                        .map((r) => (
                          <p key={r.row} className="text-xs text-red-400">
                            Row {r.row} ({r.loanNumber}): {r.error}
                          </p>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-subtle flex items-center justify-between">
          <div>
            {step === "mapping" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => { reset(); setStep("upload"); }}
                className="bg-transparent border-border-subtle text-carbon-light hover:text-offwhite"
              >
                <ChevronLeft className="w-3.5 h-3.5 mr-1" />
                Back
              </Button>
            )}
            {step === "validation" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setStep("mapping")}
                className="bg-transparent border-border-subtle text-carbon-light hover:text-offwhite"
              >
                <ChevronLeft className="w-3.5 h-3.5 mr-1" />
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {step !== "results" && step !== "importing" && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleClose}
                className="bg-transparent border-border-subtle text-carbon-light hover:text-offwhite"
              >
                Cancel
              </Button>
            )}
            {step === "mapping" && (
              <Button
                size="sm"
                onClick={proceedToValidation}
                disabled={!allFieldsMapped}
                className="bg-accent hover:bg-accent-hover text-white border-0 disabled:opacity-50"
              >
                Review
                <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            )}
            {step === "validation" && (
              <Button
                size="sm"
                onClick={handleImport}
                disabled={importing}
                className="bg-accent hover:bg-accent-hover text-white border-0"
              >
                {importing ? "Importing..." : `Import ${mappedRows.length} Customers`}
              </Button>
            )}
            {step === "results" && (
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
    </div>
  );
}
