const LAST_UPDATED = "July 27, 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-white mb-3 tracking-tight">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-gray-400">{children}</div>
    </section>
  );
}

export default function TermsPage() {
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
            <span className="text-[8px] font-bold tracking-[0.3em] uppercase text-[#b03a3a] leading-none mt-[3px]">Trading Cards</span>
          </div>
        </div>
        <div className="w-12" />
      </div>

      <article className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold mb-2">Terms &amp; Conditions</h1>
        <p className="text-xs text-gray-500 mb-10">Last updated {LAST_UPDATED}</p>

        <Section title="Acceptance of terms">
          <p>
            These Terms &amp; Conditions ("Terms") govern your access to and use of
            tommytopdecker.com (the "Site") and your purchase of products from TommyTopDecker Trading
            Cards ("we", "us", or "our"). By using the Site or placing an order, you agree to these
            Terms. If you do not agree, please do not use the Site.
          </p>
        </Section>

        <Section title="Eligibility">
          <p>
            You must be at least 18 years old, or the age of majority in your jurisdiction, to place
            an order. By purchasing, you represent that you meet this requirement and that the
            information you provide is accurate.
          </p>
        </Section>

        <Section title="Products and availability">
          <p>
            We sell trading cards and related products. Product images are for illustration.
            Sealed and randomized products (such as packs or boxes) contain randomly assorted cards;
            any pull rates or probabilities shown are estimates only, and we do not guarantee that
            any specific card will be included in a given product. All products are subject to
            availability and may sell out or be withdrawn at any time.
          </p>
        </Section>

        <Section title="Pricing and payment">
          <p>
            Prices are listed in U.S. dollars and exclude applicable taxes and shipping, which are
            calculated at checkout. Payment is processed securely by Stripe. We reserve the right to
            correct pricing errors and to cancel any order affected by such an error, refunding any
            amount already charged.
          </p>
        </Section>

        <Section title="Shipping and delivery">
          <p>
            We currently ship within the United States only. Shipping costs and options are shown at
            checkout. Delivery timeframes are estimates and are not guaranteed. Risk of loss passes
            to you upon delivery to the carrier.
          </p>
        </Section>

        <Section title="Returns and refunds">
          <p>
            Because of the collectible nature of our products, sealed and randomized items are
            generally non-returnable once opened. If your order arrives damaged or incorrect,
            contact us within 7 days of delivery and we will work with you to resolve it. Refunds,
            when issued, are returned to the original payment method.
          </p>
        </Section>

        <Section title="Acceptable use">
          <p>You agree not to use the Site to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Violate any law or regulation.</li>
            <li>Submit false, fraudulent, or misleading order information.</li>
            <li>Interfere with or attempt to gain unauthorized access to the Site or its systems.</li>
            <li>Resell products in a manner that misrepresents their origin or our brand.</li>
          </ul>
        </Section>

        <Section title="Intellectual property">
          <p>
            The Site, including its logos, text, graphics, and layout, is owned by us or our
            licensors and is protected by applicable intellectual property laws. You may not copy,
            reproduce, or use our branding without prior written permission. Trademarks of card
            manufacturers or franchises remain the property of their respective owners.
          </p>
        </Section>

        <Section title="Disclaimers">
          <p>
            The Site and products are provided "as is" and "as available" without warranties of any
            kind, whether express or implied, to the fullest extent permitted by law, except for
            warranties that cannot legally be excluded.
          </p>
        </Section>

        <Section title="Limitation of liability">
          <p>
            To the maximum extent permitted by law, we will not be liable for any indirect,
            incidental, special, or consequential damages arising from your use of the Site or
            products. Our total liability for any claim relating to an order will not exceed the
            amount you paid for that order.
          </p>
        </Section>

        <Section title="Governing law">
          <p>
            These Terms are governed by the laws of the State of [State], United States, without
            regard to its conflict-of-laws rules. Any dispute will be subject to the exclusive
            jurisdiction of the courts located in [County/State].
          </p>
        </Section>

        <Section title="Changes to these terms">
          <p>
            We may update these Terms from time to time. Changes take effect when posted, and the
            "Last updated" date above will be revised. Your continued use of the Site constitutes
            acceptance of the updated Terms.
          </p>
        </Section>

        <Section title="Contact us">
          <p>
            Questions about these Terms? Email us at{" "}
            <a href="mailto:sales@tommytopdecker.com" className="text-[#b03a3a] hover:underline">sales@tommytopdecker.com</a>.
          </p>
        </Section>
      </article>
    </main>
  );
}
