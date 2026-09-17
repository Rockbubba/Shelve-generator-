/**
 * Client-side export: DXF per plaat, alles-in-één ZIP, CSV en de
 * werktekening (SVG, DXF of print/PDF).
 * Op mobiel wordt waar mogelijk de share sheet gebruikt (Web Share API).
 */

import JSZip from "jszip";
import { bomToCsv } from "./bom";
import { buildDrawing, drawingFileName, drawingToDxf, drawingToSvg, DrawingOptions } from "./drawing";
import { sheetFileName, sheetToDxf } from "./dxf";
import { CabinetModel } from "./model";
import { NestingResult } from "./nesting";

async function deliver(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
  };
  if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: filename });
      return;
    } catch (err) {
      // Geannuleerd: klaar. Anders terugvallen op een gewone download.
      if ((err as DOMException).name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function downloadSheetDxf(
  nesting: NestingResult,
  material: "plaat18" | "hdf4",
  index: number,
) {
  const list = material === "hdf4" ? nesting.hdfSheets : nesting.sheets;
  const sheet = list[index];
  if (!sheet) return;
  await deliver(
    new Blob([sheetToDxf(sheet)], { type: "application/dxf" }),
    sheetFileName(sheet),
  );
}

export async function downloadAllDxfZip(nesting: NestingResult) {
  const zip = new JSZip();
  for (const sheet of [...nesting.sheets, ...nesting.hdfSheets]) {
    zip.file(sheetFileName(sheet), sheetToDxf(sheet));
  }
  const blob = await zip.generateAsync({ type: "blob" });
  await deliver(blob, "boekenkast-dxf.zip");
}

export async function downloadBomCsv(model: CabinetModel, nesting: NestingResult) {
  const utf8Bom = "\uFEFF"; // zodat Excel de CSV als UTF-8 opent
  await deliver(
    new Blob([utf8Bom + bomToCsv(model, nesting)], {
      type: "text/csv;charset=utf-8",
    }),
    "onderdelenlijst.csv",
  );
}

// ---- Werktekening -------------------------------------------------------------

export async function downloadDrawingSvg(model: CabinetModel, opts: DrawingOptions = {}) {
  const svg = drawingToSvg(buildDrawing(model, opts));
  await deliver(new Blob([svg], { type: "image/svg+xml" }), drawingFileName(model, "svg"));
}

export async function downloadDrawingDxf(model: CabinetModel) {
  const dxf = drawingToDxf(buildDrawing(model));
  await deliver(new Blob([dxf], { type: "application/dxf" }), drawingFileName(model, "dxf"));
}

/**
 * Werktekening in een nieuw venster op A3 liggend, met direct de
 * printdialoog (opslaan als PDF via de browser). Valt terug op een
 * SVG-download als pop-ups geblokkeerd zijn.
 */
export async function printDrawing(model: CabinetModel, opts: DrawingOptions = {}) {
  const drawing = buildDrawing(model, opts);
  const svg = drawingToSvg(drawing);
  const win = window.open("", "_blank");
  if (!win) {
    await downloadDrawingSvg(model, opts);
    return;
  }
  win.document.open();
  win.document.write(`<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><title>${drawingFileName(model, "svg").replace(".svg", "")}</title>
<style>
  @page { size: A3 landscape; margin: 0; }
  html, body { margin: 0; padding: 0; background: #e5e7eb; }
  svg { display: block; width: 420mm; height: 297mm; background: #fff; margin: 0 auto; box-shadow: 0 2px 12px rgba(0,0,0,.15); }
  @media print { body { background: #fff; } svg { box-shadow: none; } }
</style></head><body>${svg}</body></html>`);
  win.document.close();
  // Even wachten tot de SVG (en de ingesloten afbeelding) staat.
  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      // Printdialoog niet beschikbaar: het venster blijft open om te bewaren.
    }
  }, 400);
}
