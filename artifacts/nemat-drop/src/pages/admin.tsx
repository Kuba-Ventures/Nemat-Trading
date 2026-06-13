import { useState, useEffect, useRef, useCallback } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "";
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD ?? "";

type PullProb = { label: string; abbr: string; percent: number; color: string; display?: string; perCardPct?: number | null };
type PossiblePull = { id: number; title: string; subtitle: string; probability: string; scryfallImage: string; featured: boolean };
type Spec = { label: string; value: string };

type Product = {
  id: number;
  title: string;
  subtitle: string;
  price: number;
  imageUrl: string;
  stock: number;
  active: boolean;
  expiresAt: string | null;
  scryfallId: string | null;
  discountPercent: number;
  tcgplayerUrl: string | null;
  tcgMarketPriceCents: number | null;
  specs: string;
  contents: string;
  pullProbabilities: string;
  possiblePulls: string;
  intelReport: string;
  createdAt: string;
};

type View = "list" | "new" | "edit" | "waitlist" | "orders";

type AdminOrder = {
  id: number;
  date: string;
  email: string;
  name: string | null;
  item: string;
  quantity: number;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  shippingMethod: string | null;
  shippingAddress: string | null;
  stripeSessionId: string;
};

function sku(id: number) {
  return `NMT-${String(id).padStart(3, "0")}`;
}

function priceDisplay(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function toDatetimeLocal(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 16);
}

function StatusBadge({ product }: { product: Product }) {
  if (!product.active) return <span className="text-[10px] uppercase tracking-[0.15em] text-gray-600 border border-white/10 px-2 py-0.5 rounded">Hidden</span>;
  if (product.expiresAt && new Date(product.expiresAt) < new Date()) return <span className="text-[10px] uppercase tracking-[0.15em] text-red-400 border border-red-400/20 px-2 py-0.5 rounded">Expired</span>;
  return <span className="text-[10px] uppercase tracking-[0.15em] text-cyan-400 border border-cyan-400/20 px-2 py-0.5 rounded">Live</span>;
}

// ─── Shared admin nav ─────────────────────────────────────────────────────────

function AdminNav({ active, onNavigate }: { active: View; onNavigate: (v: View) => void }) {
  const tab = (key: View, label: string) => (
    <button
      onClick={() => onNavigate(key)}
      className={`text-xs uppercase tracking-[0.15em] transition-colors ${
        active === key ? "text-cyan-400" : "text-gray-500 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center justify-between mb-10">
      <a href="/" className="text-xs text-gray-500 hover:text-white transition-colors">← Storefront</a>
      <div className="flex items-center gap-6">
        {tab("list", "Products")}
        {tab("orders", "Orders")}
        {tab("waitlist", "Waitlist")}
      </div>
    </div>
  );
}

// ─── Product List ─────────────────────────────────────────────────────────────

function ProductList({ adminKey, onEdit, onNew }: {
  adminKey: string;
  onEdit: (p: Product) => void;
  onNew: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [relocking, setRelocking] = useState(false);
  const [relockResult, setRelockResult] = useState<string | null>(null);

  async function handleRelock() {
    setRelocking(true);
    setRelockResult(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/products/relock-pulls`, {
        method: "POST",
        headers: { "x-admin-key": adminKey },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `API returned ${res.status}`);
      const parts = [`${data.updated.length} updated`];
      if (data.skipped?.length) parts.push(`${data.skipped.length} skipped`);
      setRelockResult(`Re-locked accurate odds — ${parts.join(", ")}.`);
      await load();
    } catch (err: any) {
      setRelockResult(`Failed: ${err.message ?? "re-lock failed"}`);
    } finally {
      setRelocking(false);
    }
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/products`, { headers: { "x-admin-key": adminKey } });
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data = await res.json();
      const sorted = [...data].sort((a: Product, b: Product) => {
        if (a.expiresAt && b.expiresAt) return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
        if (a.expiresAt) return -1;
        if (b.expiresAt) return 1;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
      setProducts(sorted);
    } catch (err: any) {
      setLoadError(err.message ?? "Failed to load products");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-gray-500 mb-1">Nemat Trading</div>
          <h1 className="text-2xl font-bold text-white">Products</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRelock}
            disabled={relocking}
            title="Recompute accurate pull probabilities for every product from its contents + Scryfall"
            className="rounded border border-white/15 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.2em] text-gray-300 hover:border-cyan-400/40 hover:text-cyan-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {relocking ? "Re-locking…" : "Re-lock pull odds"}
          </button>
          <button
            onClick={onNew}
            className="rounded bg-cyan-400 px-5 py-2.5 text-xs font-bold uppercase tracking-[0.2em] text-black hover:bg-cyan-300 transition-colors"
          >
            + New Product
          </button>
        </div>
      </div>

      {relockResult && (
        <p className={`text-xs mb-6 ${relockResult.startsWith("Failed") ? "text-red-400" : "text-cyan-400"}`}>{relockResult}</p>
      )}

      {loading && <p className="text-gray-600 text-sm text-center py-12">Loading...</p>}
      {loadError && (
        <div className="text-center py-12 border border-red-400/20 rounded">
          <p className="text-red-400 text-sm mb-2">Could not connect to API</p>
          <p className="text-gray-600 text-xs font-mono">{API_URL}/api/admin/products</p>
          <p className="text-gray-600 text-xs mt-1">{loadError}</p>
          <button onClick={load} className="mt-4 text-xs text-cyan-400 hover:text-cyan-300 transition-colors">Retry</button>
        </div>
      )}

      {!loading && products.length === 0 && (
        <div className="text-center py-16 border border-white/[0.06] rounded">
          <p className="text-gray-600 text-sm mb-4">No products yet.</p>
          <button onClick={onNew} className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">+ Add your first product</button>
        </div>
      )}

      {!loading && products.length > 0 && (
        <div className="border border-white/[0.06] rounded overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 px-5 py-3 border-b border-white/[0.06] bg-white/[0.02]">
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-600">Product</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-600">SKU</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-600">Price</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-600">Expiry</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-600">Status</span>
          </div>

          {products.map((p, i) => (
            <button
              key={p.id}
              onClick={() => onEdit(p)}
              className={`w-full grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 px-5 py-4 text-left hover:bg-white/[0.03] transition-colors ${i < products.length - 1 ? "border-b border-white/[0.04]" : ""}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                {p.imageUrl && (
                  <img src={p.imageUrl} alt={p.title} className="w-8 h-8 object-contain flex-shrink-0 rounded opacity-80" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white truncate">{p.title}</div>
                  {p.subtitle && <div className="text-xs text-gray-600 truncate">{p.subtitle}</div>}
                </div>
              </div>
              <div className="flex items-center">
                <span className="text-xs text-gray-500 font-mono">{sku(p.id)}</span>
              </div>
              <div className="flex items-center">
                <span className="text-sm text-white">{priceDisplay(p.price)}</span>
              </div>
              <div className="flex items-center">
                <span className="text-xs text-gray-500">
                  {p.expiresAt ? new Date(p.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                </span>
              </div>
              <div className="flex items-center">
                <StatusBadge product={p} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Product Form (New / Edit) ────────────────────────────────────────────────

type LookupResult = {
  type: "set" | "card";
  suggestedTitle: string;
  setName?: string;
  setCode?: string;
  scryfallId: string | null;
  imageUrl: string | null;
  usd: string | null;
  rarityCounts?: { common: number; uncommon: number; rare: number; mythic: number };
  topCards: { id: string; name: string; imageUrl: string | null; usd: string | null; rarity?: string; probability?: string; probabilityPct?: number | null }[];
};

const emptyForm = {
  title: "", subtitle: "", tcgplayerUrl: "", imageUrl: "",
  price: "", stock: "", expiresAt: "",
  scryfallId: "", discountPercent: "15",
};

const DEFAULT_PULL_PROBS: PullProb[] = [
  { label: "Common", abbr: "C", percent: 27, color: "#6b7280" },
  { label: "Uncommon", abbr: "U", percent: 23, color: "#60a5fa" },
  { label: "Rare", abbr: "R", percent: 22, color: "#fbbf24" },
  { label: "Mythic Rare", abbr: "M", percent: 14, color: "#f97316" },
  { label: "Borderless", abbr: "B", percent: 9, color: "#a78bfa" },
];

const CLOUDINARY_CLOUD = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME ?? "";
const CLOUDINARY_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET ?? "";

// ─── Image Field ──────────────────────────────────────────────────────────────

function ImageField({ value, onChange }: {
  value: string;
  onChange: (url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [removingBg, setRemovingBg] = useState(false);

  const handleRemoveBg = useCallback(async () => {
    if (!value) return;
    setRemovingBg(true);
    setUploadError(null);
    try {
      // 1. Get transparent PNG from the backend
      const res = await fetch(`${API_URL}/api/remove-background`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Remove background failed");

      // 2. Convert base64 PNG to a File and upload to Cloudinary
      const byteString = atob(data.png.split(",")[1]);
      const arr = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) arr[i] = byteString.charCodeAt(i);
      const file = new File([arr], "product-nobg.png", { type: "image/png" });
      await handleFile(file);
    } catch (err: any) {
      setUploadError(err.message ?? "Background removal failed");
    } finally {
      setRemovingBg(false);
    }
  }, [value]);

  const handleFile = useCallback(async (file: File) => {
    if (!CLOUDINARY_CLOUD || !CLOUDINARY_PRESET) {
      setUploadError("Cloudinary env vars not set (VITE_CLOUDINARY_CLOUD_NAME, VITE_CLOUDINARY_UPLOAD_PRESET)");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("upload_preset", CLOUDINARY_PRESET);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Upload failed");
      onChange(data.secure_url);
    } catch (err: any) {
      setUploadError(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [onChange]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith("image/")) handleFile(file);
  }

  return (
    <div>
      <label className="text-[10px] uppercase tracking-[0.2em] text-gray-600 block mb-1.5">Image</label>
      <div className="flex gap-3 items-start">
        {/* Preview */}
        {value && (
          <div className="flex-shrink-0 w-16 h-16 rounded border border-white/10 overflow-hidden bg-white/[0.02] flex items-center justify-center">
            <img src={value} alt="Product" className="w-full h-full object-contain" />
          </div>
        )}
        <div className="flex-1 flex flex-col gap-2">
          {/* Drop zone / upload button */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="flex items-center gap-2 rounded border border-dashed border-white/20 px-4 py-3 hover:border-cyan-400/40 transition-colors cursor-pointer"
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            />
            {uploading ? (
              <span className="text-xs text-cyan-400">Uploading...</span>
            ) : (
              <>
                <span className="text-xs text-gray-400">Upload image</span>
                <span className="text-[10px] text-gray-600">or drag & drop</span>
              </>
            )}
          </div>
          {/* URL input + Remove BG */}
          <div className="flex gap-2">
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Or paste URL (auto-filled by Look Up)"
              className="flex-1 rounded border border-white/10 bg-black px-4 py-2.5 text-xs text-gray-400 focus:outline-none focus:border-cyan-400/40"
            />
            {value && (
              <button
                type="button"
                onClick={handleRemoveBg}
                disabled={removingBg || uploading}
                className="rounded border border-cyan-400/30 px-3 py-2 text-[10px] text-cyan-400 hover:bg-cyan-400/10 transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                {removingBg ? "Removing..." : "Remove BG"}
              </button>
            )}
          </div>
        </div>
      </div>
      {uploadError && <p className="text-[10px] text-red-400 mt-1">{uploadError}</p>}
      <p className="text-[9px] text-gray-700 mt-1 font-mono">cloud: {CLOUDINARY_CLOUD || "NOT SET"} · preset: {CLOUDINARY_PRESET || "NOT SET"}</p>
    </div>
  );
}

// ─── Pull Card Editor ─────────────────────────────────────────────────────────

function PullCardEditor({ card, onChange, onDelete }: {
  card: PossiblePull;
  onChange: (c: PossiblePull) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex flex-col">
      <div className={`relative group aspect-[2.5/3.5] rounded-lg overflow-hidden border transition-all duration-200 ${card.featured ? "border-cyan-400/60 shadow-[0_0_20px_rgba(34,211,238,0.2)]" : "border-white/10 hover:border-white/20"}`}>
        {card.scryfallImage ? (
          <img src={card.scryfallImage} alt={card.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-white/[0.03] flex items-center justify-center">
            <span className="text-gray-700 text-[10px] text-center px-3 leading-relaxed">{card.title || "No image"}</span>
          </div>
        )}

        {/* Featured toggle — top right, always visible */}
        <button
          type="button"
          onClick={() => onChange({ ...card, featured: !card.featured })}
          title={card.featured ? "Featured — click to unfeature" : "Click to feature"}
          className={`absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shadow transition-all ${card.featured ? "bg-cyan-400 text-black" : "bg-black/70 text-gray-500 hover:text-cyan-400 hover:bg-black/90"}`}
        >
          ★
        </button>

        {/* Delete — top left, on hover */}
        <button
          type="button"
          onClick={onDelete}
          className="absolute top-1.5 left-1.5 w-7 h-7 rounded-full bg-black/70 text-gray-500 hover:text-red-400 hover:bg-black/90 flex items-center justify-center text-base transition-all opacity-0 group-hover:opacity-100"
        >
          ×
        </button>

        {/* Edit — bottom right, on hover */}
        <button
          type="button"
          onClick={() => setEditing(e => !e)}
          className="absolute bottom-1.5 right-1.5 text-[9px] uppercase tracking-wider bg-black/70 hover:bg-black/90 px-2 py-1 rounded text-gray-400 hover:text-white transition-all opacity-0 group-hover:opacity-100"
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {/* Card info */}
      <div className="mt-1.5 px-0.5">
        <p className={`text-xs font-medium leading-tight truncate ${card.featured ? "text-cyan-400" : "text-gray-300"}`}>
          {card.title || <span className="text-gray-700 italic">Untitled</span>}
        </p>
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-gray-600 truncate">{card.subtitle}</p>
          <p className="text-[10px] text-gray-500 shrink-0 ml-1">{card.probability}</p>
        </div>
      </div>

      {/* Inline edit fields — shown when editing */}
      {editing && (
        <div className="mt-2 grid gap-1.5 border border-white/[0.06] rounded-lg p-3 bg-white/[0.02]">
          <input value={card.title} onChange={e => onChange({ ...card, title: e.target.value })}
            placeholder="Card name"
            className="w-full rounded border border-white/10 bg-black px-2.5 py-1.5 text-xs focus:outline-none focus:border-cyan-400/40" />
          <div className="grid grid-cols-2 gap-1.5">
            <input value={card.subtitle} onChange={e => onChange({ ...card, subtitle: e.target.value })}
              placeholder="Rarity"
              className="rounded border border-white/10 bg-black px-2.5 py-1.5 text-xs focus:outline-none focus:border-cyan-400/40" />
            <input value={card.probability} onChange={e => onChange({ ...card, probability: e.target.value })}
              placeholder="~2%"
              className="rounded border border-white/10 bg-black px-2.5 py-1.5 text-xs focus:outline-none focus:border-cyan-400/40" />
          </div>
          <input value={card.scryfallImage} onChange={e => onChange({ ...card, scryfallImage: e.target.value })}
            placeholder="Scryfall image URL"
            className="w-full rounded border border-white/10 bg-black px-2.5 py-1.5 text-[10px] font-mono focus:outline-none focus:border-cyan-400/40" />
        </div>
      )}
    </div>
  );
}

// ─── Product Form (New / Edit) ────────────────────────────────────────────────

function ProductForm({ adminKey, product, onBack, onSaved }: {
  adminKey: string;
  product: Product | null;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(product ? {
    title: product.title,
    subtitle: product.subtitle,
    tcgplayerUrl: product.tcgplayerUrl ?? "",
    imageUrl: product.imageUrl,
    price: (product.price / 100).toFixed(2),
    stock: String(product.stock),
    expiresAt: toDatetimeLocal(product.expiresAt),
    scryfallId: product.scryfallId ?? "",
    discountPercent: String(product.discountPercent ?? 15),
  } : emptyForm);

  const [specs, setSpecs] = useState<Spec[]>(
    product?.specs && product.specs !== "[]"
      ? JSON.parse(product.specs)
      : []
  );
  const [contents, setContents] = useState<string[]>(
    product?.contents && product.contents !== "[]"
      ? JSON.parse(product.contents)
      : []
  );
  const [intelReport, setIntelReport] = useState(product?.intelReport ?? "");
  const [pullProbs, setPullProbs] = useState<PullProb[]>(
    product?.pullProbabilities && product.pullProbabilities !== "[]"
      ? JSON.parse(product.pullProbabilities)
      : DEFAULT_PULL_PROBS
  );
  const [possiblePulls, setPossiblePulls] = useState<PossiblePull[]>(
    product?.possiblePulls && product.possiblePulls !== "[]"
      ? JSON.parse(product.possiblePulls)
      : []
  );

  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [stylingIntel, setStylingIntel] = useState(false);
  const [styleError, setStyleError] = useState<string | null>(null);
  // TCG market price used as reference for auto-calculating discount %
  const [tcgMarketPrice, setTcgMarketPrice] = useState(
    product?.tcgMarketPriceCents ? (product.tcgMarketPriceCents / 100).toFixed(2) : ""
  );
  const discountManuallyEdited = useRef(false);

  const isEdit = !!product;

  // Auto-calculate discount % from Nemat price and TCG market price
  useEffect(() => {
    if (discountManuallyEdited.current) return;
    const nemat = parseFloat(form.price);
    const tcg = parseFloat(tcgMarketPrice);
    if (nemat > 0 && tcg > 0 && tcg >= nemat) {
      const computed = ((1 - nemat / tcg) * 100).toFixed(2);
      setForm((f) => ({ ...f, discountPercent: computed }));
    }
  }, [form.price, tcgMarketPrice]);

  async function handleLookup() {
    const url = form.tcgplayerUrl.trim();
    if (!url) return;
    setLookupLoading(true);
    setLookupError(null);
    setLookupResult(null);
    discountManuallyEdited.current = false;
    try {
      const res = await fetch(`${API_URL}/api/lookup/tcgplayer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) { setLookupError(data.error ?? "Lookup failed"); return; }
      setLookupResult(data as LookupResult);
      // Auto-fill from result — always update image and price from lookup
      setForm((f) => ({
        ...f,
        title: f.title || data.suggestedTitle || f.title,
        scryfallId: data.scryfallId ?? f.scryfallId,
        imageUrl: data.imageUrl || f.imageUrl,  // lookup wins for image
      }));
      if (data.usd) setTcgMarketPrice(data.usd);
      // Auto-populate specs, contents, intel report from lookup
      if (data.type === "set") {
        if (data.specs?.length) setSpecs(data.specs);
        if (data.contents?.length) setContents(data.contents);
        if (data.intelReport) setIntelReport(data.intelReport);
        if (data.pullProbabilities?.length) setPullProbs(data.pullProbabilities);
      }
      // Auto-populate possible pulls from top set cards.
      // Each card's probability is the accurate per-card odds computed by the
      // backend (locked at lookup time), not a hardcoded guess.
      if (data.type === "set" && data.topCards?.length) {
        const rarityLabel: Record<string, string> = {
          mythic: "Mythic Rare",
          rare: "Rare",
          uncommon: "Uncommon",
          common: "Common",
        };
        setPossiblePulls(
          data.topCards.slice(0, 8).map((c: any, i: number) => ({
            id: Date.now() + i,
            title: c.name,
            subtitle: rarityLabel[c.rarity] ?? "Rare",
            probability: c.probability ?? "",
            scryfallImage: c.imageUrl ?? "",
            featured: i === 0,
          }))
        );
      }
    } catch (err: any) {
      setLookupError(err.message ?? "Lookup failed");
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleStyleIntel() {
    if (!intelReport.trim()) return;
    setStylingIntel(true);
    setStyleError(null);
    try {
      const res = await fetch(`${API_URL}/api/intel-report/restyle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intelReport, productTitle: form.title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Style failed");
      setIntelReport(data.intelReport);
    } catch (err: any) {
      setStyleError(err.message ?? "Failed to style");
    } finally {
      setStylingIntel(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const body = {
      title: form.title,
      subtitle: form.subtitle,
      price: Math.round(parseFloat(form.price) * 100),
      imageUrl: form.imageUrl,
      stock: parseInt(form.stock, 10) || 0,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      scryfallId: form.scryfallId,
      discountPercent: parseInt(form.discountPercent, 10) || 15,
      tcgplayerUrl: form.tcgplayerUrl,
      tcgMarketPriceCents: tcgMarketPrice ? Math.round(parseFloat(tcgMarketPrice) * 100) : null,
      specs,
      contents,
      pullProbabilities: pullProbs,
      possiblePulls: possiblePulls,
      intelReport,
    };
    try {
      const url = isEdit ? `${API_URL}/api/admin/products/${product.id}` : `${API_URL}/api/admin/products`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save");
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!product || !confirm(`Delete "${product.title}"?`)) return;
    setDeleting(true);
    await fetch(`${API_URL}/api/admin/products/${product.id}`, {
      method: "DELETE",
      headers: { "x-admin-key": adminKey },
    });
    onSaved();
  }

  async function toggleActive() {
    if (!product) return;
    await fetch(`${API_URL}/api/admin/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
      body: JSON.stringify({ active: !product.active }),
    });
    onSaved();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <button onClick={onBack} className="text-xs text-gray-500 hover:text-white transition-colors mb-2 block">← Products</button>
          <h1 className="text-2xl font-bold text-white">{isEdit ? product.title : "New Product"}</h1>
          {isEdit && <p className="text-xs text-gray-600 font-mono mt-1">{sku(product.id)}</p>}
        </div>
        {isEdit && (
          <div className="flex items-center gap-3">
            <button
              onClick={toggleActive}
              className={`text-xs px-4 py-2 rounded border transition-colors ${product.active ? "border-red-400/30 text-red-400 hover:bg-red-400/10" : "border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/10"}`}
            >
              {product.active ? "Take Offline" : "Go Live"}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs px-4 py-2 rounded border border-white/10 text-gray-500 hover:text-red-400 hover:border-red-400/30 transition-colors"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="grid gap-6">
        {/* Basic Info */}
        <section className="border border-white/[0.06] rounded bg-white/[0.02] p-6">
          <h2 className="text-[10px] uppercase tracking-[0.25em] text-gray-500 mb-5">Basic Info</h2>
          <div className="grid gap-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] uppercase tracking-[0.2em] text-gray-600 block mb-1.5">Title</label>
                <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Product name"
                  className="w-full rounded border border-white/10 bg-black px-4 py-3 text-sm focus:outline-none focus:border-cyan-400/40" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.2em] text-gray-600 block mb-1.5">Subtitle</label>
                <input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                  placeholder="e.g. Collector Booster Pack"
                  className="w-full rounded border border-white/10 bg-black px-4 py-3 text-sm focus:outline-none focus:border-cyan-400/40" />
              </div>
            </div>

            {/* TCGPlayer URL — auto-fills title, image, and TCG market price */}
            <div>
              <label className="text-[10px] uppercase tracking-[0.2em] text-gray-600 block mb-1.5">TCGPlayer URL</label>
              <div className="flex gap-2">
                <input value={form.tcgplayerUrl}
                  onChange={(e) => { setForm({ ...form, tcgplayerUrl: e.target.value }); setLookupResult(null); setLookupError(null); }}
                  placeholder="https://www.tcgplayer.com/product/..."
                  className="flex-1 rounded border border-white/10 bg-black px-4 py-3 text-sm focus:outline-none focus:border-cyan-400/40" />
                <button type="button" onClick={handleLookup} disabled={lookupLoading || !form.tcgplayerUrl.trim()}
                  className="rounded border border-cyan-400/30 px-5 py-2 text-xs text-cyan-400 hover:bg-cyan-400/10 transition-colors disabled:opacity-40 whitespace-nowrap">
                  {lookupLoading ? "Looking up..." : "Look Up"}
                </button>
              </div>
              <p className="text-[10px] text-gray-600 mt-1.5">Auto-fills title, image, and TCG market price. "TCG Best" on storefront links here.</p>
            </div>

            {lookupError && <p className="text-xs text-red-400">{lookupError}</p>}

            {lookupResult && (
              <div className="border border-white/[0.06] rounded p-4 bg-black/30">
                {lookupResult.type === "set" ? (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[10px] uppercase tracking-[0.2em] text-cyan-400">Set Found</span>
                      <span className="text-sm text-white font-medium">{lookupResult.setName}</span>
                      <span className="text-[10px] text-gray-600 font-mono uppercase">{lookupResult.setCode}</span>
                    </div>
                    <p className="text-[10px] text-gray-500 mb-3">Top cards by price shown as possible pulls on storefront:</p>
                    <div className="flex flex-wrap gap-2">
                      {lookupResult.topCards.slice(0, 8).map((c) => (
                        <div key={c.id} className="flex flex-col items-center gap-1 w-16">
                          {c.imageUrl && <img src={c.imageUrl} alt={c.name} className="w-16 rounded opacity-90" />}
                          {c.usd && <span className="text-[9px] text-cyan-400">${c.usd}</span>}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-3">
                    {lookupResult.imageUrl && <img src={lookupResult.imageUrl} alt={lookupResult.suggestedTitle} className="w-12 rounded" />}
                    <div>
                      <p className="text-sm text-white font-medium">{lookupResult.suggestedTitle}</p>
                      {lookupResult.usd && <p className="text-xs text-cyan-400 mt-0.5">TCG Market: ${lookupResult.usd}</p>}
                    </div>
                  </div>
                )}
              </div>
            )}

            <ImageField
              value={form.imageUrl}
              onChange={(url) => setForm((f) => ({ ...f, imageUrl: url }))}
            />
          </div>
        </section>

        {/* Pricing */}
        <section className="border border-white/[0.06] rounded bg-white/[0.02] p-6">
          <h2 className="text-[10px] uppercase tracking-[0.25em] text-gray-500 mb-5">Pricing & Stock</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] uppercase tracking-[0.2em] text-gray-600 block mb-1.5">Nemat Price</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <input required type="number" step="0.01" min="0" value={form.price}
                  onChange={(e) => { discountManuallyEdited.current = false; setForm({ ...form, price: e.target.value }); }}
                  placeholder="32.00"
                  className="w-full rounded border border-white/10 bg-black pl-8 pr-4 py-3 text-sm focus:outline-none focus:border-cyan-400/40" />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.2em] text-gray-600 block mb-1.5">Stock</label>
              <input type="number" min="0" value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                placeholder="0"
                className="w-full rounded border border-white/10 bg-black px-4 py-3 text-sm focus:outline-none focus:border-cyan-400/40" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.2em] text-gray-600 block mb-1.5">
                Discount %
                {tcgMarketPrice && form.price
                  ? <span className="text-gray-700 ml-1 normal-case">(auto)</span>
                  : <span className="text-gray-700 ml-1 normal-case">(manual)</span>}
              </label>
              <div className="relative">
                <input type="number" min="0" max="100" step="0.01"
                  value={form.discountPercent}
                  onChange={(e) => { discountManuallyEdited.current = true; setForm({ ...form, discountPercent: e.target.value }); }}
                  className={`w-full rounded border bg-black px-4 py-3 text-sm focus:outline-none focus:border-cyan-400/40 ${tcgMarketPrice && form.price ? "border-cyan-400/30 text-cyan-400" : "border-white/10"}`} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">%</span>
              </div>
              {tcgMarketPrice && form.price && (
                <p className="text-[10px] text-gray-600 mt-1">
                  {form.discountPercent}% off ${parseFloat(tcgMarketPrice).toFixed(2)} TCG
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Availability */}
        <section className="border border-white/[0.06] rounded bg-white/[0.02] p-6">
          <h2 className="text-[10px] uppercase tracking-[0.25em] text-gray-500 mb-5">Availability</h2>
          <div>
            <label className="text-[10px] uppercase tracking-[0.2em] text-gray-600 block mb-1.5">Deal Expires At</label>
            <input type="datetime-local" value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              className="w-full rounded border border-white/10 bg-black px-4 py-3 text-sm focus:outline-none focus:border-cyan-400/40 text-white [color-scheme:dark]" />
            <p className="text-[10px] text-gray-600 mt-2">When set, a live countdown timer appears on the storefront.</p>
          </div>
        </section>


        {/* Specifications */}
        <section className="border border-white/[0.06] rounded bg-white/[0.02] p-6">
          <h2 className="text-[10px] uppercase tracking-[0.25em] text-gray-500 mb-5">Specifications</h2>
          <div className="grid gap-6">

            {/* Specs */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] uppercase tracking-[0.2em] text-gray-600">Spec Rows</label>
                <button type="button" onClick={() => setSpecs((s) => [...s, { label: "", value: "" }])}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors">+ Add Row</button>
              </div>
              <div className="grid gap-2">
                {specs.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_32px] gap-2 items-center">
                    <input value={row.label} onChange={(e) => setSpecs((s) => s.map((r, j) => j === i ? { ...r, label: e.target.value } : r))}
                      placeholder="Label (e.g. SET)"
                      className="rounded border border-white/10 bg-black px-3 py-2 text-xs focus:outline-none focus:border-cyan-400/40 uppercase" />
                    <input value={row.value} onChange={(e) => setSpecs((s) => s.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
                      placeholder="Value (e.g. Strixhaven)"
                      className="rounded border border-white/10 bg-black px-3 py-2 text-xs focus:outline-none focus:border-cyan-400/40" />
                    <button type="button" onClick={() => setSpecs((s) => s.filter((_, j) => j !== i))}
                      className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none">×</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Contents */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] uppercase tracking-[0.2em] text-gray-600">Contents</label>
                <button type="button" onClick={() => setContents((c) => [...c, ""])}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors">+ Add Line</button>
              </div>
              <div className="grid gap-2">
                {contents.map((line, i) => (
                  <div key={i} className="grid grid-cols-[1fr_32px] gap-2 items-center">
                    <input value={line} onChange={(e) => setContents((c) => c.map((l, j) => j === i ? e.target.value : l))}
                      placeholder="e.g. 15 Magic: The Gathering cards"
                      className="rounded border border-white/10 bg-black px-3 py-2 text-xs focus:outline-none focus:border-cyan-400/40" />
                    <button type="button" onClick={() => setContents((c) => c.filter((_, j) => j !== i))}
                      className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none">×</button>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </section>

        {/* Content */}
        <section className="border border-white/[0.06] rounded bg-white/[0.02] p-6">
          <h2 className="text-[10px] uppercase tracking-[0.25em] text-gray-500 mb-5">Content</h2>
          <div className="grid gap-6">

            {/* Intel Report */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] uppercase tracking-[0.2em] text-gray-600">Intel Report</label>
                {intelReport.trim() && (
                  <button
                    type="button"
                    onClick={handleStyleIntel}
                    disabled={stylingIntel}
                    className="rounded border border-cyan-400/30 px-3 py-1 text-[10px] text-cyan-400 hover:bg-cyan-400/10 transition-colors disabled:opacity-40 whitespace-nowrap"
                  >
                    {stylingIntel ? "Styling..." : "Style It"}
                  </button>
                )}
              </div>
              <textarea value={intelReport} onChange={(e) => setIntelReport(e.target.value)} rows={6}
                placeholder={"Write product description paragraphs here.\n\nSeparate paragraphs with a blank line."}
                className="w-full rounded border border-white/10 bg-black px-4 py-3 text-sm focus:outline-none focus:border-cyan-400/40 resize-y font-sans" />
              {styleError && <p className="text-[10px] text-red-400 mt-1">{styleError}</p>}
              <p className="text-[10px] text-gray-600 mt-1">Separate paragraphs with a blank line. "Style It" rewrites in TTD brand voice.</p>
            </div>

            {/* Pull Probabilities */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] uppercase tracking-[0.2em] text-gray-600">Pull Probabilities</label>
                <button type="button" onClick={() => setPullProbs((p) => [...p, { label: "", abbr: "", percent: 0, color: "#6b7280" }])}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors">+ Add Row</button>
              </div>
              <div className="grid gap-2">
                {pullProbs.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_44px_60px_92px_48px_24px] gap-2 items-center">
                    <input value={row.label} onChange={(e) => setPullProbs((p) => p.map((r, j) => j === i ? { ...r, label: e.target.value } : r))}
                      placeholder="Label (e.g. Common)"
                      className="rounded border border-white/10 bg-black px-3 py-2 text-xs focus:outline-none focus:border-cyan-400/40" />
                    <input value={row.abbr} onChange={(e) => setPullProbs((p) => p.map((r, j) => j === i ? { ...r, abbr: e.target.value } : r))}
                      placeholder="C"
                      className="rounded border border-white/10 bg-black px-3 py-2 text-xs focus:outline-none focus:border-cyan-400/40 text-center" />
                    <div className="relative">
                      <input type="number" min="0" max="100" step="0.1" value={row.percent}
                        onChange={(e) => setPullProbs((p) => p.map((r, j) => j === i ? { ...r, percent: parseFloat(e.target.value) || 0 } : r))}
                        className="w-full rounded border border-white/10 bg-black px-2 py-2 pr-5 text-xs focus:outline-none focus:border-cyan-400/40" />
                      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-600 text-xs">%</span>
                    </div>
                    <span
                      title="Locked per-pack hit rate (computed from pack contents + Scryfall)"
                      className="text-[10px] text-gray-500 truncate px-1"
                    >{row.display ?? "—"}</span>
                    <input type="color" value={row.color} onChange={(e) => setPullProbs((p) => p.map((r, j) => j === i ? { ...r, color: e.target.value } : r))}
                      className="w-full h-9 rounded border border-white/10 bg-black cursor-pointer px-1" />
                    <button type="button" onClick={() => setPullProbs((p) => p.filter((_, j) => j !== i))}
                      className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none">×</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Possible Pulls */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-[10px] uppercase tracking-[0.2em] text-gray-600">Possible Pulls</label>
                <button type="button"
                  onClick={() => setPossiblePulls(p => [...p, { id: Date.now(), title: "", subtitle: "", probability: "", scryfallImage: "", featured: false }])}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors">+ Add Card</button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                {possiblePulls.map((card, i) => (
                  <PullCardEditor
                    key={card.id}
                    card={card}
                    onChange={updated => setPossiblePulls(p => p.map((c, j) => j === i ? updated : c))}
                    onDelete={() => setPossiblePulls(p => p.filter((_, j) => j !== i))}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setPossiblePulls(p => [...p, { id: Date.now(), title: "", subtitle: "", probability: "", scryfallImage: "", featured: false }])}
                  className="aspect-[2.5/3.5] rounded-lg border border-dashed border-white/10 hover:border-cyan-400/30 flex items-center justify-center text-gray-700 hover:text-cyan-400 transition-colors text-2xl"
                >+</button>
              </div>
              <p className="text-[9px] text-gray-700 mt-2">★ = featured on storefront · hover card to edit or delete</p>
            </div>

          </div>
        </section>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-3">
          <button type="submit" disabled={loading}
            className="rounded bg-cyan-400 px-8 py-3 text-xs font-bold uppercase tracking-[0.2em] text-black hover:bg-cyan-300 transition-colors disabled:opacity-50">
            {loading ? "Saving..." : isEdit ? "Save Changes" : "Create Product"}
          </button>
          <button type="button" onClick={onBack}
            className="rounded border border-white/10 px-6 py-3 text-xs font-bold uppercase tracking-[0.2em] text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Subscriber List ──────────────────────────────────────────────────────────

type Subscriber = { id: number; email: string; subscribedAt: string };

function SubscriberList({ adminKey }: { adminKey: string }) {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/subscribers`, { headers: { "x-admin-key": adminKey } });
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      setSubscribers(await res.json());
    } catch (err: any) {
      setLoadError(err.message ?? "Failed to load subscribers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function copyAll() {
    const text = subscribers.map((s) => s.email).join(", ");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-gray-500 mb-1">Nemat Trading</div>
          <h1 className="text-2xl font-bold text-white">Waitlist</h1>
        </div>
        <div className="flex items-center gap-4">
          {subscribers.length > 0 && (
            <button
              onClick={copyAll}
              className="rounded border border-white/10 px-4 py-2 text-xs text-gray-300 hover:text-white hover:border-white/30 transition-colors"
            >
              {copied ? "Copied!" : `Copy all (${subscribers.length})`}
            </button>
          )}
        </div>
      </div>

      {loading && <p className="text-gray-600 text-sm text-center py-12">Loading...</p>}
      {loadError && (
        <div className="text-center py-12 border border-red-400/20 rounded">
          <p className="text-red-400 text-sm mb-2">Could not load subscribers</p>
          <p className="text-gray-600 text-xs font-mono">{loadError}</p>
          <button onClick={load} className="mt-4 text-xs text-cyan-400 hover:text-cyan-300 transition-colors">Retry</button>
        </div>
      )}

      {!loading && !loadError && subscribers.length === 0 && (
        <div className="text-center py-16 border border-white/[0.06] rounded">
          <p className="text-gray-600 text-sm">No waitlist signups yet.</p>
        </div>
      )}

      {!loading && subscribers.length > 0 && (
        <div className="border border-white/[0.06] rounded overflow-hidden">
          <div className="grid grid-cols-[1fr_auto] gap-4 px-5 py-3 border-b border-white/[0.06] bg-white/[0.02]">
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-600">Email</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-600">Subscribed</span>
          </div>
          {subscribers.map((s, i) => (
            <div
              key={s.id}
              className={`grid grid-cols-[1fr_auto] gap-4 px-5 py-3.5 ${i < subscribers.length - 1 ? "border-b border-white/[0.04]" : ""}`}
            >
              <span className="text-sm text-white font-mono">{s.email}</span>
              <span className="text-xs text-gray-500 whitespace-nowrap">
                {new Date(s.subscribedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Orders ─────────────────────────────────────────────────────────────────

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function OrderList({ adminKey }: { adminKey: string }) {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/orders`, { headers: { "x-admin-key": adminKey } });
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      setOrders(await res.json());
    } catch (err: any) {
      setLoadError(err.message ?? "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }

  async function syncFromStripe() {
    setSyncing(true);
    setSyncMsg("");
    try {
      const res = await fetch(`${API_URL}/api/admin/backfill-orders`, {
        method: "POST",
        headers: { "x-admin-key": adminKey },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `API returned ${res.status}`);
      setSyncMsg(`Imported ${data.inserted}, updated ${data.updated} · scanned ${data.scanned}`);
      await load();
    } catch (err: any) {
      setSyncMsg(err.message ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => { load(); }, []);

  const revenueCents = orders.reduce((sum, o) => sum + o.totalCents, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-gray-500 mb-1">Nemat Trading</div>
          <h1 className="text-2xl font-bold text-white">Orders</h1>
        </div>
        <div className="flex items-center gap-4">
          {orders.length > 0 && (
            <span className="text-xs text-gray-500">
              {orders.length} {orders.length === 1 ? "order" : "orders"} · {money(revenueCents)}
            </span>
          )}
          {syncMsg && <span className="text-xs text-gray-500">{syncMsg}</span>}
          <button
            onClick={syncFromStripe}
            disabled={syncing}
            className="rounded border border-white/10 px-4 py-2 text-xs text-gray-300 hover:text-white hover:border-white/30 transition-colors disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync from Stripe"}
          </button>
        </div>
      </div>

      {loading && <p className="text-gray-600 text-sm text-center py-12">Loading...</p>}
      {loadError && (
        <div className="text-center py-12 border border-red-400/20 rounded">
          <p className="text-red-400 text-sm mb-2">Could not load orders</p>
          <p className="text-gray-600 text-xs font-mono">{loadError}</p>
          <button onClick={load} className="mt-4 text-xs text-cyan-400 hover:text-cyan-300 transition-colors">Retry</button>
        </div>
      )}

      {!loading && !loadError && orders.length === 0 && (
        <div className="text-center py-16 border border-white/[0.06] rounded">
          <p className="text-gray-600 text-sm">No orders yet.</p>
        </div>
      )}

      {!loading && orders.length > 0 && (
        <div className="border border-white/[0.06] rounded overflow-hidden">
          <div className="grid grid-cols-[auto_1fr_1fr_auto_auto] gap-4 px-5 py-3 border-b border-white/[0.06] bg-white/[0.02]">
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-600">Date</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-600">Item</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-600">Customer</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-600 text-center">Qty</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-600 text-right">Total</span>
          </div>
          {orders.map((o, i) => (
            <div key={o.id} className={i < orders.length - 1 ? "border-b border-white/[0.04]" : ""}>
              <button
                onClick={() => setExpanded(expanded === o.id ? null : o.id)}
                className="w-full grid grid-cols-[auto_1fr_1fr_auto_auto] gap-4 px-5 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
              >
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {new Date(o.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
                <span className="text-sm text-white truncate">{o.item}</span>
                <span className="text-xs text-gray-400 font-mono truncate">{o.email}</span>
                <span className="text-sm text-gray-300 text-center">{o.quantity}</span>
                <span className="text-sm text-cyan-400 font-semibold text-right whitespace-nowrap">{money(o.totalCents)}</span>
              </button>
              {expanded === o.id && (
                <div className="px-5 pb-4 pt-1 text-xs text-gray-400 space-y-1 bg-white/[0.01]">
                  {o.name && <div><span className="text-gray-600">Name:</span> {o.name}</div>}
                  {o.shippingAddress && <div><span className="text-gray-600">Ship to:</span> {o.shippingAddress}</div>}
                  {o.shippingMethod && <div><span className="text-gray-600">Shipping:</span> {o.shippingMethod}</div>}
                  <div className="flex flex-wrap gap-x-4 pt-1">
                    <span><span className="text-gray-600">Subtotal:</span> {money(o.subtotalCents)}</span>
                    <span><span className="text-gray-600">Shipping:</span> {money(o.shippingCents)}</span>
                    <span><span className="text-gray-600">Tax:</span> {money(o.taxCents)}</span>
                  </div>
                  <div className="text-gray-600 font-mono break-all pt-1">{o.stripeSessionId}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Root Admin ───────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const adminKey = ADMIN_PASSWORD;

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) { setAuthed(true); }
    else { setLoginError("Incorrect password"); }
  }

  if (!authed) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="text-[10px] uppercase tracking-[0.3em] text-gray-500 mb-2">Nemat Trading</div>
          <h1 className="text-2xl font-bold mb-8">Admin Access</h1>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <input type="password" placeholder="Password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded border border-white/10 bg-white/[0.03] px-4 py-3 text-sm focus:outline-none focus:border-cyan-400/40" />
            {loginError && <p className="text-sm text-red-400">{loginError}</p>}
            <button type="submit"
              className="rounded bg-cyan-400 px-5 py-3 text-xs font-bold uppercase tracking-[0.25em] text-black hover:bg-cyan-300 transition-colors">
              Enter
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white px-6 py-10">
      <div className="mx-auto max-w-4xl">
        {(view === "list" || view === "orders" || view === "waitlist") && (
          <AdminNav active={view} onNavigate={setView} />
        )}
        {view === "list" && (
          <ProductList
            adminKey={adminKey}
            onEdit={(p) => { setEditingProduct(p); setView("edit"); }}
            onNew={() => { setEditingProduct(null); setView("new"); }}
          />
        )}
        {(view === "new" || view === "edit") && (
          <ProductForm
            adminKey={adminKey}
            product={editingProduct}
            onBack={() => setView("list")}
            onSaved={() => setView("list")}
          />
        )}
        {view === "waitlist" && <SubscriberList adminKey={adminKey} />}
        {view === "orders" && <OrderList adminKey={adminKey} />}
      </div>
    </main>
  );
}
