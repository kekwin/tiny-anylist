# CLAUDE.md – tiny-anylist

Lille uofficiel TypeScript-klient til AnyList (læs lister, tilføj, afkryds, omdøb, slet). Repo: https://github.com/kekwin/tiny-anylist
(**offentligt** når det er udgivet). Tal med ejeren på dansk; README og kode er på engelsk. Push direkte til `main`.
Fælles regler: [summer-hub/CLAUDE.md](https://github.com/kekwin/summer-hub/blob/main/CLAUDE.md) (privat repo).

## Regler

- **Offentligt repo, ingen hemmeligheder eller rigtige data.** Aldrig kodeord, tokenfiler, `.env` eller udtræk af Kewins rigtige lister,
  heller ikke i tests, README eller commit-beskeder. Tests bruger kun `example.invalid` og opdigtede varer.
- Kodeordet må kun sendes til `https://www.anylist.com/auth/token`. Fejlbeskeder må aldrig indeholde det.
- Hold klienten lille: ingen opskrifter, madplan eller websocket, før en app har brug for det.
- Skemaet i `src/schema.ts` stammer fra MIT-pakken `anylist` (Max Isom). Behold kildeangivelsen.
- Skrivning kræver multipart **uden** filename (hånd-bygget i `multipartBinary`): med `FormData`+`Blob` svarer AnyList 200 og gør ingenting.
- Live-prøven (`npm run smoke`) skriver kun til listen med `--write`, og kun med Kewins ja til den konkrete liste.

## Kør og test

`npm test` (6 enhedstests mod en falsk AnyList) · `npm run build` · `npm run smoke -- <env-fil> "<liste>" [--write]`.
Kewins login ligger i en env-fil under `~/.config/summer/` (uden for repoet).

## Status

0.1.0: klient skrevet og prøvet live mod Kewins indkøbsliste (læs, tilføj, afkryds, slet) 6. november 2026.

## Næste skridt

- Udgiv på npm (Kewin kører selv `npm login` og `npm publish`; `prepublishOnly` kører typecheck, test og build). Repo og MIT-licens er på plads (6. november 2026).
- Brug klienten i indkøbsagenten (nemlig/BilkaToGo via handle-mcp): se summer-recipes/docs/IDE-NEMLIG.md.
