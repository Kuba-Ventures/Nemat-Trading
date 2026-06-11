import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "@/lib/supabase";

const API_URL = import.meta.env.VITE_API_URL ?? "";

type Order = {
  id: number;
  date: string;
  item: string;
  quantity: number;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  shippingMethod: string | null;
};

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-black text-white px-6 py-10">
      <div className="mx-auto max-w-2xl flex items-center justify-between mb-10">
        <a
          href="/"
          className="flex items-center gap-2 text-xs text-gray-500 hover:text-white transition-colors"
        >
          <span>←</span>
          <span>Back</span>
        </a>
        <div className="flex items-center gap-2">
          <img src="/wizard.png" alt="Nemat" className="w-6 h-6 object-contain opacity-90" />
          <span className="text-xs font-bold uppercase tracking-[0.4em] text-white">Nemat</span>
        </div>
        <div className="w-12" />
      </div>
      <div className="mx-auto max-w-2xl">{children}</div>
    </main>
  );
}

export default function AccountPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Sign-in form state
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  // Orders state
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [ordersError, setOrdersError] = useState("");

  // Track the auth session (and pick up the magic-link redirect on load).
  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load order history once signed in.
  useEffect(() => {
    if (!session) {
      setOrders(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setOrdersError("");
      try {
        const res = await fetch(`${API_URL}/api/account/orders`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setOrders(data.orders ?? []);
      } catch {
        if (!cancelled) setOrdersError("Couldn't load your orders. Please try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSending(true);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/account` },
    });
    setSending(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSent(true);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setSent(false);
    setEmail("");
  }

  if (!supabaseConfigured) {
    return (
      <Shell>
        <p className="text-gray-400 text-sm">
          Accounts aren't configured yet. Set <code className="text-cyan-400">VITE_SUPABASE_URL</code>{" "}
          and <code className="text-cyan-400">VITE_SUPABASE_ANON_KEY</code> to enable sign-in.
        </p>
      </Shell>
    );
  }

  if (loading) {
    return (
      <Shell>
        <p className="text-gray-500 text-sm">Loading…</p>
      </Shell>
    );
  }

  // ── Signed out: magic-link request form ───────────────────────────────
  if (!session) {
    return (
      <Shell>
        <h1 className="text-3xl font-bold text-cyan-400 mb-3">Your Account</h1>
        {sent ? (
          <p className="text-gray-400 text-sm leading-relaxed">
            Check your inbox — we sent a sign-in link to{" "}
            <span className="text-white">{email}</span>. Click it to view your order history.
            You can close this tab.
          </p>
        ) : (
          <>
            <p className="text-gray-400 text-sm mb-6">
              Enter your email and we'll send you a secure sign-in link — no password needed.
              Sign in with the same email you used at checkout to see everything you've bought.
            </p>
            <form onSubmit={sendMagicLink} className="flex flex-col gap-3 max-w-sm">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="rounded bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-cyan-400/60"
              />
              <button
                type="submit"
                disabled={sending}
                className="rounded bg-cyan-400 px-8 py-3 text-xs font-bold uppercase tracking-[0.25em] text-black hover:bg-cyan-300 transition-colors disabled:opacity-50"
              >
                {sending ? "Sending…" : "Email me a sign-in link"}
              </button>
              {error && <p className="text-red-400 text-xs">{error}</p>}
            </form>
          </>
        )}
      </Shell>
    );
  }

  // ── Signed in: order history ──────────────────────────────────────────
  return (
    <Shell>
      <div className="flex items-start justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-cyan-400 mb-1">Your Orders</h1>
          <p className="text-gray-500 text-xs">{session.user.email}</p>
        </div>
        <button
          onClick={signOut}
          className="shrink-0 rounded border border-white/15 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.15em] text-gray-300 hover:bg-white/[0.06] transition-colors"
        >
          Sign out
        </button>
      </div>

      {ordersError && <p className="text-red-400 text-sm">{ordersError}</p>}

      {!ordersError && orders === null && (
        <p className="text-gray-500 text-sm">Loading your orders…</p>
      )}

      {!ordersError && orders?.length === 0 && (
        <p className="text-gray-400 text-sm">
          No orders yet under this email.{" "}
          <a href="/" className="text-cyan-400 hover:underline">
            Browse the current drop →
          </a>
        </p>
      )}

      {orders && orders.length > 0 && (
        <ul className="flex flex-col gap-3">
          {orders.map((o) => (
            <li
              key={o.id}
              className="rounded border border-white/10 bg-white/[0.02] px-5 py-4 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{o.item}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {formatDate(o.date)} · Qty {o.quantity}
                  {o.shippingMethod ? ` · ${o.shippingMethod}` : ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-cyan-400">{money(o.totalCents)}</p>
                <p className="text-[10px] text-gray-600 uppercase tracking-wider">Total</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
