// Plain description of the buying flow as the code runs it today:
// drop page -> /checkout (ZIP, shipping rate, optional code) -> Stripe Checkout
// (address, payment, sales tax) -> confirmation email -> label bought through
// Shippo for the chosen service -> tracking email. Keep it in step with that.

const SUPPORT_EMAIL = "sales@tommytopdecker.com";

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Pick the current drop",
    body: (
      <>
        Each drop is one factory-sealed product, listed with its price and contents. Choose how many
        you want (up to 2 per order) and select Acquire.
      </>
    ),
  },
  {
    title: "Get shipping rates",
    body: (
      <>
        On the checkout page, enter your 5-digit US ZIP code to see live shipping options and prices,
        then pick one. If you have a promo code, enter it with your email; each code is one use per
        customer.
      </>
    ),
  },
  {
    title: "Pay on Stripe",
    body: (
      <>
        You finish on Stripe's secure checkout page. That is where you enter your shipping address
        and payment details. Your chosen shipping and any sales tax are added there before you pay.
        We ship to US addresses only.
      </>
    ),
  },
  {
    title: "Get your confirmation",
    body: <>As soon as your payment goes through, we email you an order confirmation.</>,
  },
  {
    title: "We pack and ship",
    body: (
      <>
        We pack your order, buy the shipping label through Shippo for the service you chose, and
        email you the tracking number.
      </>
    ),
  },
];

export default function HowItWorksPage() {
  return (
    <main className="min-h-screen bg-black text-white px-6 py-10">
      {/* Header */}
      <div className="mx-auto max-w-2xl flex items-center justify-between mb-10">
        <a href="/" className="flex items-center gap-2 text-xs text-gray-500 hover:text-white transition-colors">
          <span>←</span><span>Back</span>
        </a>
        <div className="flex items-center gap-3">
          <img src="/logo-mark.svg" alt="Tommy Top Decker" className="w-10 h-auto block" />
          <div className="flex flex-col">
            <span className="text-[13px] font-bold tracking-[0.16em] uppercase text-[#f4f0e8] leading-none">TommyTopDecker</span>
            <span className="text-[10px] font-bold tracking-[0.3em] uppercase text-[#c85a5a] leading-none mt-[3px]">Trading Cards</span>
          </div>
        </div>
        <div className="w-12" />
      </div>

      <article className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold mb-2">How It Works</h1>
        <p className="text-sm text-gray-400 mb-10">
          We sell factory-sealed trading card packs, one drop at a time. Here is what happens from
          checkout to your door.
        </p>

        <ol className="space-y-8">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span className="shrink-0 w-7 h-7 rounded-full border border-cyan-400/50 text-cyan-400 text-xs font-bold flex items-center justify-center tabular-nums">
                {i + 1}
              </span>
              <div>
                <h2 className="text-lg font-bold text-white mb-2 tracking-tight">{step.title}</h2>
                <p className="text-sm leading-relaxed text-gray-400">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-12 text-sm leading-relaxed text-gray-400">
          Questions about an order? Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#b03a3a] hover:underline">{SUPPORT_EMAIL}</a>{" "}
          or see{" "}
          <a href="/support" className="text-[#b03a3a] hover:underline">Support</a>.
        </p>
      </article>
    </main>
  );
}
