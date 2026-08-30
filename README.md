# Boekenkast-configurator met CNC-output

Webapp (Tylko/Regalraum-stijl) waarmee je een boekenkast parametrisch
configureert. Output: plaat-geoptimaliseerde DXF-bestanden per plaat en een
onderdelenlijst (CSV + printbare PDF) voor een flatbed CNC met platen van
**2440 × 1220 × 18 mm**.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- three.js (vanilla) voor de 3D-preview in toon-/palletstijl
- Nesting en DXF-generatie volledig client-side — geen backend

## Ontwikkelen

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # vitest: model-, nesting- en DXF-tests
npm run build      # productie-build
```

## Hoe het werkt

### Ontwerp náár de plaat (strip-nesting)

De plaat wordt eerst opgedeeld in stroken op kastdiepte. Freesbaan 8 mm,
plaatrand 10 mm rondom vrij. De diepte-opties in de UI zijn precies de
waardes waarbij `n` stroken plus freesbanen de 1220 mm exact vullen:

| Stroken | Diepte |
| ------- | ------ |
| 2       | 596 mm |
| 3       | 394,6 mm |
| 4       | 294 mm |

De gevraagde kastbreedte wordt stilletjes (± max 12 mm) aangepast zodat
`m` planken plus freesbanen een strook van 2420 mm exact vullen; ver van
zo'n grens blijft de gevraagde maat staan en toont de UI de restlengte.

Onderdelen worden first-fit-decreasing over de stroken verdeeld: staanders
(langste onderdelen) eerst, planken op de restlengtes. HDF-rugpanelen
nesten apart op een eigen 4mm-plaat.

### Constructie

- Doorlopende staanders (H × D), planken ertussen.
- **Blinde dado** (default): groef in de staander, 7 mm diep, breedte =
  gemeten plaatdikte, stopt 30 mm vóór de voorzijde. De plankhoeken krijgen
  een inkeping van 7 × 34 mm (dadodiepte × stopafstand + freesradius) zodat
  de voorzijde vlak sluit. Per naad een Ø8-boring in de dadobodem plus een
  blinde Ø8-boring in het plankvlak (onderzijde) als montageborging met
  deuvel 8 × 35 en lijm.
- **Cabineo** (demontabel): 2 pockets per naad in het plankvlak
  (onderzijde, laag `CABINEO_12MM`) + doorlopende Ø5-boutgaten in de
  staander (laag `BOOR_5MM`).
- Kasten hoger dan 2400 mm worden automatisch opgedeeld in gestapelde
  modules met elk hun eigen staanders.

### Schrankstabiliteit

- Rugpanelen: 4 mm HDF per vak in een gefreesde groef
  (`RUG_SPONNING`: 4 mm breed, 10 mm diep, 12 mm uit de achterkant).
  De generator stelt automatisch hoekvakken + de onderste rij voor;
  per vak te togglen door in de 3D-preview op het vak te tikken.
- Muurbevestiging: 2 L-beugels in de hardware-lijst, verplicht getoond
  boven 1500 mm hoogte.
- Kast zonder enige rug én zonder muurbevestiging geeft een waarschuwing.

### DXF-output

Eén DXF (AC1015, mm) per plaat, lagen gescheiden per bewerking:

| Laag | Bewerking |
| ---- | --------- |
| `CONTOUR` | doorfrezen (gesloten polylines) |
| `DADO_7MM` | pocket 7 mm diep |
| `BOOR_8MM` | deuvelboringen Ø8 |
| `BOOR_5MM` | Cabineo-boutgaten Ø5 (doorlopend) |
| `CABINEO_12MM` | Cabineo-pockets 12,5 mm diep |
| `RUG_SPONNING` | groef 4 mm breed, 10 mm diep |
| `GRAVURE` | onderdeel-ID's, 0,5 mm diep |
| `PLAATRAND` | referentie, niet frezen |

Bewerkingen aan de tweede zijde (binnenstaanders hebben dado's aan beide
kanten; plank-onderzijdes) staan gespiegeld op lagen met suffix `_B`:
het onderdeel wordt daarvoor over de **lange zijde** omgeklapt.

### Datamodel v2-klaar

Elk vak heeft een `fill`-property (`open | rug | deur | lade | diagonaal`),
zodat deurtjes, lades en diagonale schotten later zonder refactor per vak
configureerbaar zijn.

## Projectstructuur

```
lib/config.ts     — constanten, types, diepte-opties
lib/model.ts      — parametrisch kastmodel → panelen + bewerkingen + hardware
lib/nesting.ts    — strip-nesting, yield
lib/dxf.ts        — DXF-writer (lagen, polylines, cirkels, tekst)
lib/bom.ts        — onderdelenlijst + CSV
lib/export.ts     — downloads (DXF, zip, CSV) met share sheet op mobiel
lib/render/       — three.js scene (toon-materialen, edges, palletstijl)
components/       — configurator-UI (mobile first: 3D + bottom sheet;
                    desktop: drie kolommen)
app/              — Next.js App Router
```
