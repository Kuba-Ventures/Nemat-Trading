import type Stripe from "stripe";

// Promotion codes (e.g. the thank-you insert's TOPDECK10) are one use per
// customer. Stripe can't enforce that for guest checkout, so the storefront
// collects the code and email itself, we check the email's past paid sessions
// here, and the Checkout Session is created with the discount applied and the
// email locked. Stripe's own promo box stays off so a code can't skip the check.
//
// Known gaps (accepted): a buyer can use a different email, and two checkouts
// opened at the same moment with the same email both pass, since only
// completed sessions count.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9_-]{1,64}$/.test(code) ? code : null;
}

/** True if this Checkout Session applied the given promotion code. */
export function sessionUsedPromo(session: Pick<Stripe.Checkout.Session, "discounts">, promoId: string): boolean {
  return (session.discounts ?? []).some((d) => {
    const pc = d.promotion_code;
    return (typeof pc === "string" ? pc : pc?.id) === promoId;
  });
}

export type AppliedPromo = {
  id: string;
  code: string;
  percentOff: number | null;
  amountOffCents: number | null;
};

export type PromoResult =
  | { ok: true; promo: AppliedPromo }
  | { ok: false; error: string };

export async function resolvePromo(stripe: Stripe, rawCode: unknown, rawEmail: unknown): Promise<PromoResult> {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, error: "Enter a valid promo code" };
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, error: "Enter a valid email to use a promo code" };

  // `code` matching is case-insensitive on Stripe's side.
  const { data } = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
  const pc = data[0];
  if (!pc || !pc.coupon.valid) return { ok: false, error: "That code isn't valid" };

  for await (const s of stripe.checkout.sessions.list({
    customer_details: { email },
    status: "complete",
    limit: 100,
  })) {
    if (sessionUsedPromo(s, pc.id)) {
      return { ok: false, error: "This code has already been used with this email" };
    }
  }

  return {
    ok: true,
    promo: {
      id: pc.id,
      code: pc.code,
      percentOff: pc.coupon.percent_off ?? null,
      amountOffCents: pc.coupon.amount_off ?? null,
    },
  };
}
