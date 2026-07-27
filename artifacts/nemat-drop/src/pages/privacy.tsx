const LAST_UPDATED = "July 27, 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-white mb-3 tracking-tight">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-gray-400">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
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
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-xs text-gray-500 mb-10">Last updated {LAST_UPDATED}</p>

        <Section title="Overview">
          <p>
            This Privacy Policy explains how TommyTopDecker Trading Cards ("we", "us", or "our")
            collects, uses, and protects your information when you visit tommytopdecker.com (the
            "Site") and purchase products from us. By using the Site, you agree to the practices
            described here.
          </p>
        </Section>

        <Section title="Information we collect">
          <p>We collect the following categories of information:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="text-gray-300">Contact &amp; order details</span> — name, email address, phone number, and shipping address you provide at checkout.</li>
            <li><span className="text-gray-300">Payment information</span> — processed securely by Stripe. We do not receive or store your full card number.</li>
            <li><span className="text-gray-300">Marketing signups</span> — the email address you submit if you join our mailing list.</li>
            <li><span className="text-gray-300">Usage data</span> — basic technical information such as browser type and pages viewed, used to operate and improve the Site.</li>
          </ul>
        </Section>

        <Section title="How we use your information">
          <ul className="list-disc pl-5 space-y-1">
            <li>To process, fulfill, and ship your orders.</li>
            <li>To send order confirmations, receipts, and shipping updates.</li>
            <li>To respond to your questions and provide customer support.</li>
            <li>To send marketing emails if you have opted in (you can unsubscribe at any time).</li>
            <li>To detect, prevent, and address fraud or abuse.</li>
          </ul>
        </Section>

        <Section title="Payment processing">
          <p>
            Payments are handled by Stripe, Inc. Your payment details are transmitted directly to
            Stripe and are subject to Stripe's privacy policy. We receive only limited transaction
            information (such as the last four digits of your card and billing metadata) needed to
            manage your order.
          </p>
        </Section>

        <Section title="Shipping">
          <p>
            We use third-party shipping providers (via Shippo) to calculate rates and deliver your
            order. The name and address you provide are shared with the relevant carrier solely to
            fulfill your shipment.
          </p>
        </Section>

        <Section title="Sharing your information">
          <p>
            We do not sell your personal information. We share it only with service providers who
            help us operate the Site and fulfill orders (for example, payment processing, shipping,
            and email delivery), and only as needed for those purposes, or where required by law.
          </p>
        </Section>

        <Section title="Cookies">
          <p>
            The Site uses cookies and similar technologies that are necessary for core functionality
            such as maintaining your cart and session. We do not use them to build advertising
            profiles.
          </p>
        </Section>

        <Section title="Data retention">
          <p>
            We keep order and contact information for as long as needed to fulfill orders, comply
            with legal and tax obligations, and resolve disputes. You may request deletion of your
            information subject to those obligations.
          </p>
        </Section>

        <Section title="Your rights">
          <p>
            Depending on where you live, you may have the right to access, correct, or delete the
            personal information we hold about you, and to opt out of marketing communications. To
            make a request, contact us using the details below.
          </p>
        </Section>

        <Section title="Children's privacy">
          <p>
            The Site is not directed to children under 13, and we do not knowingly collect personal
            information from them. If you believe a child has provided us information, please contact
            us and we will delete it.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            We may update this Privacy Policy from time to time. When we do, we will revise the "Last
            updated" date above. Continued use of the Site after changes take effect constitutes
            acceptance of the updated policy.
          </p>
        </Section>

        <Section title="Contact us">
          <p>
            Questions about this policy or your information? Email us at{" "}
            <a href="mailto:sales@tommytopdecker.com" className="text-[#b03a3a] hover:underline">sales@tommytopdecker.com</a>.
          </p>
        </Section>
      </article>
    </main>
  );
}
