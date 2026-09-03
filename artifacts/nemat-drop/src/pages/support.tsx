const SUPPORT_EMAIL = "sales@tommytopdecker.com";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-white mb-3 tracking-tight">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-gray-400">{children}</div>
    </section>
  );
}

export default function SupportPage() {
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
        <h1 className="text-3xl font-bold mb-2">Support</h1>
        <p className="text-sm text-gray-400 mb-10">
          Need a hand with an order? We're here to help — here's how to reach us and answers to the
          questions we hear most.
        </p>

        <Section title="Contact us">
          <p>
            The fastest way to reach us is by email at{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#b03a3a] hover:underline">{SUPPORT_EMAIL}</a>.
            We aim to respond within 1–2 business days. When you write in about an existing order,
            please include your <span className="text-gray-300">order number</span> and the{" "}
            <span className="text-gray-300">email used at checkout</span> so we can find it quickly.
          </p>
        </Section>

        <Section title="Order &amp; shipping help">
          <ul className="list-disc pl-5 space-y-1">
            <li>Orders are processed and shipped within the United States only.</li>
            <li>You'll receive an order confirmation by email as soon as your payment goes through.</li>
            <li>Shipping timeframes shown at checkout are estimates and can vary by carrier.</li>
            <li>Need to change or cancel an order? Email us right away — we can usually help if it hasn't shipped yet.</li>
          </ul>
        </Section>

        <Section title="Damaged or incorrect orders">
          <p>
            If your order arrives damaged or isn't what you ordered, email us at{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#b03a3a] hover:underline">{SUPPORT_EMAIL}</a>{" "}
            within <span className="text-gray-300">7 days of delivery</span> with your order number and
            a photo of the issue. We'll make it right. See our{" "}
            <a href="/terms" className="text-[#b03a3a] hover:underline">Terms &amp; Conditions</a> for full details.
          </p>
        </Section>

        <Section title="Returns">
          <p>
            Because of the collectible nature of our products, sealed and randomized items are
            generally non-returnable once opened. Full details are in our{" "}
            <a href="/terms" className="text-[#b03a3a] hover:underline">Terms &amp; Conditions</a>.
          </p>
        </Section>

        <Section title="About sealed &amp; randomized products">
          <p>
            Packs and boxes contain randomly assorted cards. Any pull rates or odds shown on the Site
            are estimates only — we can't guarantee a specific card will appear in any given product.
          </p>
        </Section>

        <Section title="Your privacy">
          <p>
            For details on how we handle your information, see our{" "}
            <a href="/privacy" className="text-[#b03a3a] hover:underline">Privacy Policy</a>.
          </p>
        </Section>
      </article>
    </main>
  );
}
