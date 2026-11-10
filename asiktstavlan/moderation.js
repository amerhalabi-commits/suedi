import { WHOLE_WORDS, FRAGMENTS } from "./blocklist.js";

const LEET = { "0": "o", "1": "i", "!": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t", "8": "b", "+": "t" };

function normalize(text) {
  let t = text.toLowerCase().normalize("NFKC");
  t = t.replace(/[0134578@$!+]/g, (c) => LEET[c] || c);
  // ta bort ihopkopplade upprepningar: "fuuuuck" -> "fuck"
  t = t.replace(/(.)\1{2,}/g, "$1");
  return t;
}

const whole = new Set(WHOLE_WORDS);

export function wordFilter(text) {
  const n = normalize(text);
  // ord för ord (för korta ord)
  const words = n.split(/[^a-zåäöéü]+/).filter(Boolean);
  for (const w of words) if (whole.has(w)) return w;
  // ihopskrivet, utan mellanslag/tecken ("n.e.g.e.r", "w h i t e power")
  const squashed = n.replace(/[^a-zåäöéü]/g, "").replace(/(.)\1+/g, "$1");
  for (const f of FRAGMENTS) {
    const fs = f.replace(/(.)\1+/g, "$1");
    if (squashed.includes(fs)) return f;
  }
  // ord som delats upp med tecken mellan varje bokstav ("k.u.k")
  const singles = n.match(/(?:\b[a-zåäö]\b[^a-zåäö]{0,2}){3,}/g) || [];
  for (const s of singles) {
    const joined = s.replace(/[^a-zåäö]/g, "");
    if (whole.has(joined)) return joined;
  }
  return null;
}

const PROMPT = `Du är moderator för en offentlig svensk anslagstavla där vem som helst kan dela åsikter anonymt.
Bedöm inlägget nedan. Åsikter – även kontroversiella, politiska, kritiska eller arga – är TILLÅTNA.
Inlägget ska till manuell granskning ("granska") om det innehåller något av följande:
- hets mot folkgrupp: hot mot eller uttryck för missaktning av en grupp p.g.a. etnicitet, hudfärg, nationalitet, religion, sexuell läggning eller könsidentitet
- rasism eller rasistiska/nedsättande ord om grupper, även omskrivna eller kodade (t.ex. hundvisslingar, nazistiska koder)
- vulgärt, sexuellt eller grovt kränkande språk
- hot, uppmaning till våld, trakasserier eller förtal av namngivna privatpersoner
- personuppgifter (telefonnummer, adresser), spam eller reklam
Annars "ok".

Svara ENDAST med JSON, exakt formatet:
{"beslut":"ok"|"granska","kategori":"kort kategori eller tom sträng","motivering":"max 15 ord på svenska"}

Alias: <<<ALIAS>>>
Inlägg: <<<TEXT>>>`;

export async function aiModerate(alias, text) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { decision: "review", reason: "AI-granskning ej konfigurerad" };
  const prompt = PROMPT.replace("<<<ALIAS>>>", JSON.stringify(alias)).replace("<<<TEXT>>>", JSON.stringify(text));
  try {
    const base = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
    const res = await fetch(base + "/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.MODERATION_MODEL || "claude-haiku-5-5",
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error("HTTP " + res.status + " " + (await res.text()).slice(0, 200));
    const data = await res.json();
    const out = (data.content || []).map((c) => c.text || "").join("");
    const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    if (json.beslut === "ok") return { decision: "ok", reason: "" };
    return { decision: "review", reason: [json.kategori, json.motivering].filter(Boolean).join(": ") || "AI flaggade" };
  } catch (e) {
    console.error("AI-moderering misslyckades:", e.message);
    // Säkert läge: hellre i kön än publicerat ogranskat
    return { decision: "review", reason: "AI-granskning otillgänglig just nu" };
  }
}

export async function moderate(alias, text) {
  const hit = wordFilter(alias + " " + text);
  if (hit) return { decision: "review", reason: `Ordfilter: "${hit}"` };
  return aiModerate(alias, text);
}
