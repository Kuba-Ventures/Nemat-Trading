import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { buildJwt, funnelRequest, GA4_SCOPE, parseFunnel, parseServiceAccount } from "./ga4";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const KEY = { client_email: "ttd-ga4@example.iam.gserviceaccount.com", private_key: PEM };

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

test("parseServiceAccount reads raw JSON and base64 JSON, rejects junk", () => {
  const raw = JSON.stringify({ ...KEY, type: "service_account" });
  assert.equal(parseServiceAccount(raw).client_email, KEY.client_email);
  assert.equal(parseServiceAccount(Buffer.from(raw).toString("base64")).client_email, KEY.client_email);
  assert.throws(() => parseServiceAccount("not a key"), /not valid JSON/);
  assert.throws(() => parseServiceAccount(JSON.stringify({ client_email: "x" })), /missing/);
});

test("buildJwt has the right header and claims and a signature that verifies", () => {
  const jwt = buildJwt(KEY, 1_800_000_000);
  const [h, c, sig] = jwt.split(".");
  assert.deepEqual(decode(h), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(decode(c), {
    iss: KEY.client_email,
    scope: GA4_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: 1_800_000_000,
    exp: 1_800_003_600,
  });
  assert.ok(!/[=+/]/.test(jwt), "base64url, unpadded");
  const ok = createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, "base64url"));
  assert.equal(ok, true);
});

test("funnelRequest asks for daily sessions plus one report per step", () => {
  const body = funnelRequest("2026-10-01", "2026-10-14");
  assert.equal(body.requests.length, 4);
  assert.deepEqual(body.requests[0].dateRanges, [{ startDate: "2026-10-01", endDate: "2026-10-14" }]);
  assert.match(JSON.stringify(body.requests[2]), /"\/checkout"/);
  assert.match(JSON.stringify(body.requests[3]), /"\/success"/);
});

test("parseFunnel builds steps, percentages, conversion and the daily series", () => {
  const days = ["2026-10-12", "2026-10-13", "2026-10-14"];
  const m = parseFunnel(
    {
      reports: [
        {
          rows: [
            { dimensionValues: [{ value: "20261012" }], metricValues: [{ value: "400" }] },
            { dimensionValues: [{ value: "20261014" }], metricValues: [{ value: "841" }] },
            { dimensionValues: [{ value: "20260901" }], metricValues: [{ value: "9" }] },
          ],
          totals: [{ metricValues: [{ value: "1240" }] }],
        },
        { rows: [{ metricValues: [{ value: "930" }] }] },
        { rows: [{ metricValues: [{ value: "96" }] }] },
        { rows: [{ metricValues: [{ value: "18" }] }] },
      ],
    },
    days,
  );
  assert.equal(m.sessions, 1240);
  assert.deepEqual(m.steps.map((s) => s.sessions), [1240, 930, 96, 18]);
  assert.equal(m.steps[0].pctOfPrevious, null);
  assert.equal(Math.round(m.steps[1].pctOfPrevious!), 75);
  assert.equal(Math.round(m.conversion! * 100) / 100, 1.45);
  assert.deepEqual(m.daily, [
    { date: "2026-10-12", sessions: 400 },
    { date: "2026-10-13", sessions: 0 },
    { date: "2026-10-14", sessions: 841 },
  ]);
});

test("parseFunnel guards empty reports and zero steps", () => {
  const m = parseFunnel({ reports: [{}, {}, {}, {}] }, ["2026-10-14"]);
  assert.equal(m.sessions, 0);
  assert.equal(m.conversion, null);
  assert.deepEqual(m.steps.map((s) => s.pctOfPrevious), [null, null, null, null]);
  const empty = parseFunnel({}, []);
  assert.equal(empty.steps.length, 4);
});
