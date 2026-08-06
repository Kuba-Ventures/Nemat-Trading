
import { product as staticProduct } from "@/data/product";
import { useActiveProduct } from "@/hooks/useActiveProduct";

export default function ProductSpecifications() {
  const dbProduct = useActiveProduct();

  const specs: { label: string; value: string }[] =
    dbProduct?.specs && dbProduct.specs !== "[]"
      ? JSON.parse(dbProduct.specs)
      : staticProduct.specs;

  const contents: string[] =
    dbProduct?.contents && dbProduct.contents !== "[]"
      ? JSON.parse(dbProduct.contents)
      : staticProduct.contents;

  const copyright = staticProduct.copyright;

  return (
    <section className="py-10 border-t border-white/5">
      <span className="text-[10px] uppercase tracking-[0.3em] text-gray-500 block mb-2">Details</span>
      <h2 className="text-xl font-semibold text-white tracking-wide mb-10">Product Specifications</h2>

      {/* Datasheet: specs table left, contents right; stacks on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
        {/* Specs */}
        <div>
          <h3 className="text-[10px] uppercase tracking-[0.25em] text-gray-500 mb-4">Specs</h3>
          <dl className="divide-y divide-white/5">
            {specs.map((spec) => (
              <div key={spec.label} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-[11px] uppercase tracking-[0.1em] text-gray-500 flex-shrink-0">{spec.label}</dt>
                <dd className="text-sm text-white text-right">{spec.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Contents */}
        <div>
          <h3 className="text-[10px] uppercase tracking-[0.25em] text-gray-500 mb-4">Contents</h3>
          <ul className="space-y-2">
            {contents.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-gray-400">
                <span className="text-cyan-500/50 mt-0.5 flex-shrink-0">—</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Copyright */}
      {copyright && (
        <p className="text-[10px] text-gray-600 mt-10 leading-relaxed">{copyright}</p>
      )}
    </section>
  );
}
