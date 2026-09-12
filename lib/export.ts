/**
 * Client-side export: DXF per plaat, alles-in-één ZIP en CSV.
 * Op mobiel wordt waar mogelijk de share sheet gebruikt (Web Share API).
 */

import JSZip from "jszip";
import { bomToCsv } from "./bom";
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
