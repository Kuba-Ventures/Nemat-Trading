import { Router } from "express";
import { db, productsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ORIGIN_ZIP, SHIPPO_API, parcelFor } from "../lib/shippo";

type ShippoRate = {
  object_id: string;
  amount: string;
  currency: string;
  provider: string;
  servicelevel: { name: string; token: string };
  estimated_days: number | null;
};

type ShippoShipmentResponse = {
  rates: ShippoRate[];
  messages?: Array<{ source?: string; code?: string; text?: string }>;
};

const router = Router();

router.post("/shipping/rates", async (req, res) => {
  const { productId, quantity, destinationZip } = req.body as {
    productId: number;
    quantity: number;
    destinationZip: string;
  };

  if (!productId || !quantity || quantity < 1) {
    res.status(400).json({ error: "productId and quantity are required" });
    return;
  }
  if (!destinationZip || !/^\d{5}$/.test(destinationZip)) {
    res.status(400).json({ error: "destinationZip must be a 5-digit US ZIP code" });
    return;
  }

  const token = process.env.SHIPPO_API_TOKEN;
  if (!token) {
    res.status(500).json({ error: "Shipping not configured" });
    return;
  }

  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, productId));
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  try {
    const shipmentRes = await fetch(`${SHIPPO_API}/shipments/`, {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address_from: { zip: ORIGIN_ZIP, country: "US" },
        address_to: { zip: destinationZip, country: "US" },
        // Same parcel the label is bought with (lib/shippo.ts).
        parcels: [parcelFor(quantity)],
        async: false,
      }),
    });

    if (!shipmentRes.ok) {
      const text = await shipmentRes.text();
      console.error("[shipping] shippo error:", shipmentRes.status, text);
      res.status(502).json({ error: "Could not fetch shipping rates" });
      return;
    }

    const shipment = (await shipmentRes.json()) as ShippoShipmentResponse;
    const uspsRates = (shipment.rates ?? []).filter((r) => r.provider === "USPS");

    if (uspsRates.length === 0) {
      console.warn("[shipping] no USPS rates returned:", shipment.messages);
      res.status(502).json({ error: "No shipping rates available for this address" });
      return;
    }

    const rates = uspsRates
      .map((r) => ({
        rateId: r.object_id,
        service: r.servicelevel.name,
        amountCents: Math.round(parseFloat(r.amount) * 100),
        currency: r.currency.toLowerCase(),
        estimatedDays: r.estimated_days,
      }))
      .sort((a, b) => a.amountCents - b.amountCents);

    res.json({ rates });
  } catch (err) {
    console.error("[shipping] failed:", err);
    res.status(500).json({ error: "Shipping lookup failed" });
  }
});

export default router;
