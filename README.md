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
  (onderzijde), exact volgens het officiële Lamello-maatblad: drie
  Ø15-cirkels haaks op de naad, harten op 3,6 / 14,8 / 26 mm vanaf het
  plankeinde, 11 mm diep. Drie plaatsingsvarianten, kiesbaar in de UI:
  *boor Ø15* (3 boringen, laag `BOOR_15MM_D11`), *frees Ø10 of kleiner*
  (exacte verenigingscontour) en *frees Ø12* (contour met rechte brugjes
  op y = ±6), beide op laag `CABINEO_11MM`. In de staander: Ø5-boutgaten
  (binnenstaanders doorlopend; buitenstaanders blind 8 mm — officiële
  diepte Cabineo 8; bij HPL Ø5,5 boren).
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

Eén DXF (R12 / AC1009, mm) per plaat — het meest universeel leesbare
DXF-formaat (VCarve, Fusion, Illustrator) — lagen gescheiden per bewerking:

| Laag | Bewerking |
| ---- | --------- |
| `CONTOUR` | doorfrezen (gesloten polylines) |
| `DADO_7MM` | pocket 7 mm diep |
| `BOOR_8MM_D15` | deuvelboring Ø8, 15 mm diep (dadobodem staander) |
| `BOOR_8MM_D10` | deuvelboring Ø8, 10 mm diep (plankvlak, blind) |
| `BOOR_5MM_DOOR` | Cabineo-boutgaten Ø5, doorlopend (binnenstaanders) |
| `BOOR_5MM_D8` | Cabineo-boutgaten Ø5, blind 8 mm (buitenstaanders) |
| `BOOR_15MM_D11` | Cabineo plaatsing via boren: 3 × Ø15, 11 mm diep |
| `CABINEO_11MM` | Cabineo-pocketcontour (3 × Ø15-klaverblad), 11 mm diep |
| `RUG_SPONNING` | groef 4 mm breed, 10 mm diep |
| `GRAVURE` | onderdeel-ID's, 0,5 mm diep |
| `PLAATRAND` | referentie, niet frezen |

DXF is 2D: de freesdiepte reist mee via de laagconventie. Boringen krijgen
daarom een expliciet diepte-suffix (`_D15` = 15 mm vanaf het vlak,
`_DOOR` = doorlopend), zodat je in CAM per laag één diepte instelt.

### Éénzijdig frezen

Het ontwerp minimaliseert omklappen op het bed:

- **Planken liggen ondersteboven** in de DXF: deuvelgaten, Cabineo-pockets
  en gravure zitten allemaal op de onderzijde en worden in één opspanning
  gefreesd.
- **Cabineo-boutgaten**: in binnenstaanders doorlopend vanaf één zijde
  (de uitgang wordt afgedekt door de plank aan de andere kant); in
  buitenstaanders blind (Ø5 × 8 mm bij Cabineo 8, 12 mm bij Cabineo 12) vanaf de binnenzijde, zodat de
  buitenwang gaaf blijft. De randafstanden verschillen per staanderzijde
  (60 vs 100 mm) zodat bouten van linker- en rechtervak elkaar niet
  raken. Een Cabineo-kast is daarmee **volledig éénzijdig**.
- **Rug geschroefd** (default): het HDF-paneel overlapt de achterranden en
  wordt geschroefd — geen groeven. De optie *sponning* freest wél groeven
  en vergt dan bewerkingen aan twee zijden.
- **Blinde dado**: binnenstaanders hebben onvermijdelijk dado's aan beide
  zijden — dit zijn de enige onderdelen die omgeklapt worden. Die
  bewerkingen staan gespiegeld op lagen met suffix `_B`: omklappen over de
  **lange zijde** (staanders) resp. de **korte zijde** (planken, alleen bij
  rug-in-sponning).

De nesting-preview in de UI tekent alle bewerkingen mee (gestippeld =
tweede zijde), zodat je vóór het downloaden kunt controleren of dado's en
boringen op de juiste plek zitten.

### Materiaal, Cabineo-maat en kosten

- **Materiaal**: MDF, multiplex berken, spaanplaat (melamine) en HPL/compact,
  elk met eigen leverbare diktes (`SHEET_MATERIALS` in `lib/config.ts`).
  De gemeten plaatdikte blijft apart instelbaar (±1,5 mm rond de nominale
  dikte) en stuurt de dado-breedte. HPL schakelt automatisch naar
  Ø5,5-boutgaten voor Cabineo (laag `BOOR_5_5MM_…`), conform Lamello.
- **Cabineo 8 of 12**: zelfde pocket, andere schroefdiepte (8 resp. 12 mm)
  en minimale plaatdikte (16 resp. 19 mm); de validatie waarschuwt bij een
  te dunne plaat. Kleinere Cabineo-maten bestaan niet.
- **Machinetijd & kosten** (`lib/costing.ts`): contourlengtes × passes,
  uitruimlengte van pockets/groeven (oppervlak / effectieve baanbreedte),
  boringen en insteltijd per plaat → minuten en bewerkingskosten; plus
  materiaalkosten zodra een plaatprijs bekend is. De klant ziet alleen
  tijd en prijzen.
- **Admin-menu** op `/admin` (niet gelinkt vanuit de klant-UI): machine-
  parameters (voeding, snededieptes, frees, boortijden, insteltijd,
  uurtarief), plaatprijzen per materiaal × dikte en een schakelaar om het
  kostenblok te tonen. Opslag in localStorage van het apparaat — geen
  echte beveiliging; voor een publieke omgeving hoort hier een login voor.

### Speelse indeling en voorkantprofiel

- **Planken weglaten**: selecteer een tussenplank (in 3D of in de editor)
  en kies "Plank weglaten"; de vakken erboven en eronder versmelten tot één
  hoog vak (dado's, boringen, rugpanelen en raycast-vakken volgen). De
  weggelaten plank blijft als doorzichtige ghost zichtbaar — aantikken zet
  hem terug. Boven- en
  onderplank zijn structureel en blijven altijd. Boven 1000 mm vakhoogte
  waarschuwt de validatie voor ontbrekend dwarsverband.
- **Vakhoogtes per kolom**: in stap 2 staat een compact vooraanzicht van de
  indeling. Tik op een tussenplank (daar of in 3D) om hem te selecteren en
  sleep hem omhoog/omlaag (snapt op 10 mm) of gebruik de stepper; de
  vakken in die kolom veranderen mee, buurkolommen niet. Het model begrenst
  op 120 mm vakhoogte. Dado's/boringen in de staanders volgen per zijde.
  "Plank weglaten" en "Terug op grid" staan bij de geselecteerde plank.
- **Voorkantprofiel** (recht / golf / bol / hol / schuin): de voorkant wijkt
  over de breedte terug volgens `frontOffset(x)`. Staanders krijgen de
  diepte op hun eigen positie (rechthoekig, dado stopt 30 mm vóór hun eigen
  voorrand), planken een gebogen voorrand als echte contour waarvan de
  uiteinden exact op de staanderdiepte liggen (vlakke naad). De
  amplitude is begrensd zodat de kast nergens ondieper dan 120 mm wordt;
  onderdelen blijven binnen de strookhoogte, dus de nesting verandert niet.
  De DXF-contour van ondersteboven liggende planken wordt over de korte
  zijde gespiegeld.

### Muur, pootjes en kleur

- **Scheve muur (verloop achter)**: geef links en rechts op hoeveel mm de
  achterkant wordt ingekort; het verloop ertussen is lineair. Staanders
  krijgen hun eigen achterkant (en dus diepte), planken een schuine
  achterrand als contour. Alle dieptematen worden intern in één globaal
  assenstelsel (muurlijn = 0) gerekend en per onderdeel naar het eigen
  CNC-frame vertaald, zodat dado's en boringen aan beide kanten van een naad
  exact samenvallen.
- **Bestaande muurplint**: hoogte en diepte opgeven; staanders krijgen
  achter-onder een inkeping en planken onder de plinthoogte worden met de
  plintdiepte ingekort (dado's beginnen daar later). De kast valt zo strak
  tegen de muur.
- **Pootjes**: type (rond / vierkant / conisch), hoogte, dikte en kleur;
  2 per staander, gerenderd in 3D en geteld in de hardware-lijst. De romp
  wordt met de poothoogte verkort zodat de totale hoogte gelijk blijft.
- **Profiel spiegelen**: elk voorkantprofiel (incl. schuin) is links↔rechts
  om te draaien.
- **Kleur**: acht presets plus vrije kleurkiezer; de rug wordt iets donkerder
  getint, pootjes hebben een eigen kleur.

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
