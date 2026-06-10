import app from "./app";
import { pool } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      stock INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      specs TEXT NOT NULL DEFAULT '[]',
      contents TEXT NOT NULL DEFAULT '[]',
      expires_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE products ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS scryfall_id TEXT DEFAULT '';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_percent INTEGER DEFAULT 15;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS tcgplayer_url TEXT DEFAULT '';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS tcg_market_price_cents INTEGER;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS pull_probabilities TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS possible_pulls TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS intel_report TEXT NOT NULL DEFAULT '';

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      stripe_session_id TEXT NOT NULL UNIQUE,
      customer_email TEXT NOT NULL,
      customer_name TEXT,
      product_id INTEGER,
      quantity INTEGER NOT NULL,
      subtotal_cents INTEGER NOT NULL,
      shipping_cents INTEGER NOT NULL,
      shipping_method TEXT,
      total_cents INTEGER NOT NULL,
      shipping_address TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscribers (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      subscribed_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    -- Lock these tables down from Supabase's public Data API (anon key).
    -- We connect as the postgres role, which bypasses RLS, so the app is
    -- unaffected. With RLS on and no policies, the Data API returns nothing.
    ALTER TABLE products    ENABLE ROW LEVEL SECURITY;
    ALTER TABLE orders      ENABLE ROW LEVEL SECURITY;
    ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
  `);

  // Seed the default product if the table is empty
  const { rows } = await pool.query("SELECT COUNT(*) FROM products");
  if (Number(rows[0].count) === 0) {
    await pool.query(`
      INSERT INTO products (title, subtitle, price, image_url, stock, active, specs, contents)
      VALUES (
        'Teenage Mutant Ninja Turtles',
        'Collector Booster Pack',
        3200,
        '/tmnt-booster-nobg.png',
        50,
        true,
        '[{"label":"SET","value":"Teenage Mutant Ninja Turtles"},{"label":"RELEASE","value":"2025"},{"label":"PACKS / BOX","value":"1"},{"label":"CARDS / PACK","value":"15"}]',
        '["15 Magic: The Gathering cards","0–3 surge foil cards","9–12 traditional foil cards","5 cards of rarity rare or higher","3–4 uncommon cards","5–6 common cards","1 land card"]'
      )
    `);
    console.log("Default product seeded");
  }

  console.log("Database ready");
}

migrate()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("Database migration failed:", err);
    process.exit(1);
  });
