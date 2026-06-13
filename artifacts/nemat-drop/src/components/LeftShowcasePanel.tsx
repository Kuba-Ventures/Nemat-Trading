import { useEffect, useRef, useState, useCallback } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "";
import { useActiveProduct } from "@/hooks/useActiveProduct";

function getTimeLeft(iso: string) {
  const diff = Math.max(0, new Date(iso).getTime() - Date.now());
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return { h, m, s, done: diff === 0 };
}
function pad(n: number) { return String(n).padStart(2, "0"); }

function SideCountdown({ expiresAt }: { expiresAt: string }) {
  const [time, setTime] = useState(() => getTimeLeft(expiresAt));
  useEffect(() => {
    const id = setInterval(() => setTime(getTimeLeft(expiresAt)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] uppercase tracking-[0.25em] text-gray-500 mb-1">
        {time.done ? "Deal Expired" : "Deal Expires In"}
      </span>
      {!time.done && (
        <div className="flex items-end gap-0.5">
          {[{ v: time.h, l: "HRS" }, { v: time.m, l: "MIN" }, { v: time.s, l: "SEC" }].map((unit, i) => (
            <div key={unit.l} className="flex items-end">
              <div className="flex flex-col items-center">
                <span className="text-4xl font-mono font-bold text-cyan-400 tracking-widest tabular-nums">
                  {pad(unit.v)}
                </span>
                <span className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mt-1">{unit.l}</span>
              </div>
              {i < 2 && <span className="text-3xl md:text-4xl font-mono text-cyan-400/60 mx-1 mb-4">:</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniEmailSignup() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) throw new Error("Failed to subscribe");
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [email]);

  return (
    <div className="w-full border-t border-white/[0.06] pt-4">
      <p className="text-[10px] uppercase tracking-[0.25em] text-gray-500 text-center mb-3">
        Never Miss a Drop
      </p>
      {submitted ? (
        <p className="text-[11px] text-cyan-400 text-center">You're on the list.</p>
      ) : (
        <form onSubmit={handleSubmit} className="flex gap-0">
          <input
            ref={inputRef}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
            disabled={loading}
            className="flex-1 min-w-0 bg-white/[0.03] border border-white/10 border-r-0 rounded-l px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/40 transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-cyan-400 text-black text-[10px] font-bold uppercase tracking-[0.15em] rounded-r hover:bg-cyan-300 transition-colors flex-shrink-0 disabled:opacity-50"
          >
            {loading ? "..." : "Notify"}
          </button>
        </form>
      )}
      {error && <p className="text-[11px] text-red-400 text-center mt-2">{error}</p>}
    </div>
  );
}

export default function LeftShowcasePanel() {
  const dbProduct = useActiveProduct();

  return (
    <aside className="
      w-full md:w-1/2
      md:h-full overflow-hidden
      bg-black flex flex-col
      border-r border-white/[0.04]
    ">
      {/* Product image — fills space above bottom section, never overflows */}
      <div className="h-72 md:min-h-0 md:flex-1 relative px-10 pt-8 pb-2 overflow-hidden">
        {/* Glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(circle at 50% 50%, rgba(34,211,238,0.12) 0%, transparent 70%)" }}
        />
        <div className="relative z-10 w-full h-full flex items-center justify-center">
          {dbProduct?.imageUrl ? (
            <img
              src={dbProduct.imageUrl}
              alt={dbProduct.title}
              className="w-full h-full object-contain drop-shadow-[0_0_40px_rgba(34,211,238,0.4)]"
            />
          ) : (
            <div className="w-48 h-64 rounded-lg bg-white/[0.04] animate-pulse" />
          )}
        </div>
      </div>

      {/* Bottom: countdown + email signup — always visible */}
      <div className="px-8 pb-6 pt-4 flex flex-col items-center gap-4 shrink-0 min-h-[200px] justify-end">
        {dbProduct?.expiresAt ? (
          <SideCountdown expiresAt={dbProduct.expiresAt} />
        ) : (
          <span className="text-[10px] uppercase tracking-[0.3em] text-gray-600">
            Secure checkout powered by Stripe
          </span>
        )}
        <MiniEmailSignup />
      </div>
    </aside>
  );
}
