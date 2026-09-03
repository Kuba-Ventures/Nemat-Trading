
import { useId, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export default function EmailSignup() {
  const inputId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
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
  };

  return (
    <section className="py-10 border-t border-white/5">
      <div className="max-w-xl">
        <span className="text-[10px] uppercase tracking-[0.3em] text-gray-500 block mb-2">Alerts</span>
        <h2 className="text-2xl font-semibold text-white tracking-wide mb-2">Never Miss a Drop</h2>
        <p className="text-sm text-gray-500 mb-8">
          Get notified when the next sealed deal goes live.
        </p>

        {submitted ? (
          <div role="status" className="flex items-center gap-3 text-sm text-cyan-400">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
              <path d="M3 8L6.5 11.5L13 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            You're on the list. We'll reach out before the next drop.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <form onSubmit={handleSubmit} className="flex gap-0">
              {/* The placeholder is a format hint, not a name: it is not exposed as
                  an accessible name and it disappears on focus. */}
              <label htmlFor={inputId} className="sr-only">
                Email address for drop notifications
              </label>
              <input
                id={inputId}
                name="email"
                autoComplete="email"
                data-signup="footer"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                disabled={loading}
                aria-describedby={error ? errorId : undefined}
                aria-invalid={error ? true : undefined}
                className="flex-1 bg-white/[0.03] border border-white/10 border-r-0 rounded-l px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-colors disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-3 bg-cyan-400 text-black text-xs font-bold uppercase tracking-[0.2em] rounded-r hover:bg-cyan-300 active:bg-cyan-500 transition-colors disabled:opacity-50"
              >
                {loading ? "..." : "Subscribe"}
              </button>
            </form>
            {error && <p id={errorId} role="alert" className="text-xs text-red-400">{error}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
