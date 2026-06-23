import { useState } from "react";
import { useLocation } from "wouter";
import { Lock, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function UnlockPage() {
  const [, navigate] = useLocation();
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
        credentials: "include",
      });
      if (res.ok) {
        const redirect = sessionStorage.getItem("heer_redirect") ?? "/";
        sessionStorage.removeItem("heer_redirect");
        navigate(redirect);
      } else {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? "Fehler beim Entsperren");
      }
    } catch {
      setError("Netzwerkfehler. Bitte erneut versuchen.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F8F3] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-[#E2E8F0] overflow-hidden">
        <div className="bg-sidebar px-8 py-8 flex flex-col items-center gap-2">
          <img
            src="/images/heer-logo.png"
            alt="B. Heer AG"
            style={{ height: "36px", width: "auto" }}
          />
          <div className="text-accent text-sm font-semibold tracking-[0.12em] mt-1">
            HEER VIEWER
          </div>
        </div>

        <form onSubmit={handleUnlock} className="px-8 py-8 flex flex-col gap-5">
          <div className="flex items-center justify-center gap-2 text-[#4A5568]">
            <Lock className="w-4 h-4 shrink-0" />
            <p className="text-sm font-semibold">Zugang mit PIN entsperren</p>
          </div>

          <div className="flex flex-col gap-2">
            <Input
              type="password"
              placeholder="PIN eingeben"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="text-center text-base tracking-widest"
              autoFocus
              autoComplete="off"
              disabled={loading}
            />
            {error && (
              <div className="flex items-center gap-1.5 text-red-600 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <Button
            type="submit"
            disabled={loading || !pin.trim()}
            className="w-full bg-[#B8CC5A] hover:bg-[#a3b84a] text-[#2D3748] font-semibold"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Entsperren
          </Button>

          <p className="text-[10px] text-[#A0AEC0] text-center leading-relaxed">
            PIN ändern: Replit → Secrets →{" "}
            <code className="font-mono bg-[#F7F8F3] px-1 rounded">ACCESS_PIN</code>{" "}
            → Server neu starten
          </p>
        </form>
      </div>
    </div>
  );
}
