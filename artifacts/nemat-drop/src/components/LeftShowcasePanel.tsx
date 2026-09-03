import { useId, useRef, useState, useCallback } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "";
import { useActiveProduct } from "@/hooks/useActiveProduct";

function MiniEmailSignup() {
  const inputId = useId();
  const errorId = useId();
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
        <p role="status" className="text-[11px] text-cyan-400 text-center">You're on the list.</p>
      ) : (
        <form onSubmit={handleSubmit} className="flex gap-0">
          {/* Same field as the footer signup, different placement. The label is
              visually hidden because the heading above already carries the
              meaning for sighted users. */}
          <label htmlFor={inputId} className="sr-only">
            Email address for drop notifications
          </label>
          <input
            ref={inputRef}
            id={inputId}
            name="email"
            autoComplete="email"
            data-signup="showcase"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
            disabled={loading}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
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
      {error && <p id={errorId} role="alert" className="text-[11px] text-red-400 text-center mt-2">{error}</p>}
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
      <div className="h-96 md:min-h-0 md:flex-1 relative px-6 pt-6 pb-2 overflow-hidden">
        {/* Spotlight glow behind the product */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 70% 55% at 50% 45%, rgba(34,211,238,0.30) 0%, transparent 68%)" }}
        />
        <div className="relative z-10 w-full h-full flex flex-col items-center justify-center">
          {dbProduct?.imageUrl ? (
            <>
              <img
                src={dbProduct.imageUrl}
                alt={dbProduct.title}
                className="w-full flex-1 min-h-0 object-contain drop-shadow-[0_0_60px_rgba(34,211,238,0.55)]"
              />
              {/* Floor reflection — fades out, decorative only */}
              <img
                src={dbProduct.imageUrl}
                alt=""
                aria-hidden="true"
                className="w-full h-16 object-contain object-top opacity-20"
                style={{
                  transform: "scaleY(-1)",
                  filter: "blur(1px)",
                  WebkitMaskImage: "linear-gradient(to bottom, black, transparent)",
                  maskImage: "linear-gradient(to bottom, black, transparent)",
                }}
              />
            </>
          ) : (
            <div className="w-48 h-64 rounded-lg bg-white/[0.04] animate-pulse" />
          )}
        </div>
      </div>

      {/* Bottom: trust line + email signup — always visible */}
      <div className="px-8 pb-6 pt-4 flex flex-col items-center gap-4 shrink-0 min-h-[200px] justify-end">
        {/* The drop deadline lives in the hero strip (desktop) and the purchase
            bar (mobile). This slot carries the trust signal instead, so the same
            countdown is not rendered twice on one screen. */}
        <span className="text-[10px] uppercase tracking-[0.3em] text-gray-600">
          Secure checkout powered by Stripe
        </span>
        <MiniEmailSignup />
      </div>
    </aside>
  );
}
