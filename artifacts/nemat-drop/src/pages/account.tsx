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

type Mode = "signin" | "signup" | "reset";

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

const inputClass =
  "rounded bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-cyan-400/60";
const primaryBtn =
  "rounded bg-cyan-400 px-8 py-3 text-xs font-bold uppercase tracking-[0.25em] text-black hover:bg-cyan-300 transition-colors disabled:opacity-50";
const linkBtn = "text-xs text-gray-500 hover:text-cyan-400 transition-colors";

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
        <div className="flex items-center gap-3">
          <img src="/logo-mark.svg" alt="Tommy Top Decker" className="w-10 h-auto block" />
          <span className="text-[13px] font-bold tracking-[0.16em] uppercase text-[#f4f0e8]">TommyTopDecker</span>
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
  const [recovering, setRecovering] = useState(false); // arrived via password-reset link

  // Auth form state
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(""); // "check your email"-style confirmations
  const [error, setError] = useState("");

  // Orders state
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [ordersError, setOrdersError] = useState("");

  // Track the auth session (and pick up magic-link / reset redirects on load).
  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load order history once signed in (but not while setting a new password).
  useEffect(() => {
    if (!session || recovering) {
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
  }, [session, recovering]);

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const addr = email.trim();
    const redirect = `${window.location.origin}/account`;

    try {
      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: addr,
          password,
        });
        if (err) throw err;
        // session updates via onAuthStateChange
      } else if (mode === "signup") {
        if (password !== confirmPassword) {
          setError("Passwords don't match.");
          return;
        }
        const { data, error: err } = await supabase.auth.signUp({
          email: addr,
          password,
          options: { emailRedirectTo: redirect },
        });
        if (err) throw err;
        if (!data.session) {
          setNotice(
            `Account created. Check ${addr} for a confirmation link, then come back and sign in.`,
          );
        }
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(addr, {
          redirectTo: redirect,
        });
        if (err) throw err;
        setNotice(`If an account exists for ${addr}, a password reset link is on its way.`);
      }
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendMagicLink() {
    setError("");
    setNotice("");
    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/account` },
    });
    setBusy(false);
    if (err) setError(err.message);
    else setNotice(`Check ${email.trim()} for a one-time sign-in link.`);
  }

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setRecovering(false);
    setPassword("");
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setPassword("");
    setMode("signin");
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

  // ── Arrived from a password-reset link: set a new password ────────────
  if (recovering) {
    return (
      <Shell>
        <h1 className="text-3xl font-bold text-cyan-400 mb-3">Set a new password</h1>
        <form onSubmit={updatePassword} className="flex flex-col gap-3 max-w-sm">
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password (min 6 characters)"
            className={inputClass}
          />
          <button type="submit" disabled={busy} className={primaryBtn}>
            {busy ? "Saving…" : "Save password"}
          </button>
          {error && <p className="text-red-400 text-xs">{error}</p>}
        </form>
      </Shell>
    );
  }

  // ── Signed out: sign in / sign up / reset ─────────────────────────────
  if (!session) {
    return (
      <Shell>
        <h1 className="text-3xl font-bold text-cyan-400 mb-3">
          {mode === "signup" ? "Create your account" : mode === "reset" ? "Reset password" : "Your Account"}
        </h1>
        <p className="text-gray-400 text-sm mb-6">
          {mode === "signup"
            ? "Use the same email you checkout with so your orders show up here."
            : mode === "reset"
              ? "Enter your email and we'll send a link to set a new password."
              : "Sign in to see everything you've bought."}
        </p>

        {notice ? (
          <div className="max-w-sm">
            <p className="text-gray-300 text-sm leading-relaxed mb-4">{notice}</p>
            <button onClick={() => switchMode("signin")} className={linkBtn}>
              ← Back to sign in
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-sm">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                autoComplete="email"
                className={inputClass}
              />
              {mode !== "reset" && (
                <div className="relative">
                  <input
                    type={showPassword && mode === "signup" ? "text" : "password"}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "signup" ? "Create a password (min 6 characters)" : "Password"}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    className={`${inputClass} w-full ${mode === "signup" ? "pr-16" : ""}`}
                  />
                  {mode === "signup" && (
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-3 my-auto h-min text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 hover:text-cyan-400 transition-colors"
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  )}
                </div>
              )}
              {mode === "signup" && (
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  autoComplete="new-password"
                  className={inputClass}
                />
              )}
              <button type="submit" disabled={busy} className={primaryBtn}>
                {busy
                  ? "Working…"
                  : mode === "signup"
                    ? "Create account"
                    : mode === "reset"
                      ? "Send reset link"
                      : "Sign in"}
              </button>
              {error && <p className="text-red-400 text-xs">{error}</p>}
            </form>

            <div className="flex flex-col gap-2 mt-5 max-w-sm">
              {mode === "signin" && (
                <>
                  <div className="flex justify-between">
                    <button onClick={() => switchMode("signup")} className={linkBtn}>
                      Create an account
                    </button>
                    <button onClick={() => switchMode("reset")} className={linkBtn}>
                      Forgot password?
                    </button>
                  </div>
                  <div className="border-t border-white/[0.06] my-2" />
                  <button onClick={sendMagicLink} disabled={busy} className={linkBtn}>
                    Email me a one-time sign-in link instead
                  </button>
                </>
              )}
              {mode !== "signin" && (
                <button onClick={() => switchMode("signin")} className={linkBtn}>
                  ← Back to sign in
                </button>
              )}
            </div>
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
