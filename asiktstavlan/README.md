# Åsiktstavlan

En anonym åsiktstavla i Mentimeter-stil. Vem som helst skriver en åsikt med valfritt alias och andra kan gilla den. Ju fler likes ett inlägg får, desto större blir det. Inlägg raderas automatiskt efter 30 dagar.

## Så fungerar modereringen

1. **Ordfilter** (`blocklist.js`): fångar svordomar, slurs och kodade varianter som `h0ra`, `f.u.c.k` och `n3g3r`.
2. **AI-granskning** med Claude: bedömer varje inlägg och fångar hets mot folkgrupp, rasism, hot, vulgärt språk och personuppgifter, även när inga "fula ord" används. Vanliga åsikter, även arga eller politiska, går igenom.
3. **Godkännandekö**: allt som flaggas hamnar i kön på `/admin`. Där godkänner du, avvisar eller raderar.
4. **Anmälan**: om tre olika besökare anmäler ett publicerat inlägg tas det ner och läggs tillbaka i kön.
5. **Spamskydd**: man får skriva ett inlägg per 30 sekunder och högst 20 per dag och IP-adress.

Om AI-granskningen inte är inställd eller inte svarar hamnar **alla** inlägg i kön. Det är ett säkert standardläge.

## Inställningar (miljövariabler)

| Variabel | Behövs? | Beskrivning |
|---|---|---|
| `ADMIN_PASSWORD` | Ja | Lösenord till `/admin`. Välj ett långt lösenord. |
| `ANTHROPIC_API_KEY` | Rekommenderas | API-nyckel från https://console.anthropic.com för AI-granskning. |
| `BOARD_QUESTION` | Nej | Frågan högst upp, t.ex. `Vad borde skolan satsa mer på?` |
| `DB_PATH` | Nej | Var databasen sparas. Standard är `./data/tavlan.db`. |
| `PORT` | Nej | Sätts automatiskt av de flesta webbhotell. |

AI-granskningen kostar väldigt lite, i storleksordningen några kronor per tusen inlägg.

## Lägg ut sidan på nätet (Railway)

Det enda kravet är Node.js 22.13 eller senare. Inga andra paket behövs.

1. Skapa ett konto på https://github.com och ladda upp mappen som ett nytt repository.
2. Skapa ett konto på https://railway.com och välj **New Project → Deploy from GitHub repo**.
3. Under **Variables** lägger du till `ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`, gärna `BOARD_QUESTION`, samt `DB_PATH=/data/tavlan.db`.
4. Högerklicka på tjänsten och välj **Attach Volume** med mount path `/data`. **Viktigt:** utan en volym försvinner inläggen varje gång servern startas om.
5. Under **Settings → Networking → Generate Domain** får du en adress, t.ex. `asiktstavlan.up.railway.app`.
6. Klart! Moderera på `https://din-adress/admin`.

Andra webbhotell med Node.js och beständig disk fungerar på samma sätt, t.ex. Render (med Disk), Fly.io (med Volume) eller en egen VPS.

## Kör lokalt

```bash
ADMIN_PASSWORD=hemligt ANTHROPIC_API_KEY=sk-ant-... npm start
# öppna http://localhost:3000 och http://localhost:3000/admin
```

## Ansvar

Den som driver en öppen tavla i Sverige ska enligt lagen om elektroniska anslagstavlor hålla uppsikt och ta bort uppenbart olagligt innehåll, till exempel hets mot folkgrupp. Titta därför i kön regelbundet. Inget filter är perfekt.
