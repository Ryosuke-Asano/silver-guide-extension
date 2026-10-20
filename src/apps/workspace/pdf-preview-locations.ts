import type { PdfField, PdfPlacement } from "../../domain/pdf";

export type PdfPreviewLocationAlias =
  | { kind: "direct"; placementIndex: number }
  | { kind: "option"; optionId: string; optionIndex: number; placementIndex: number; label: string };

export type PdfPreviewLocation = {
  key: string;
  number: number;
  fieldNumber: number;
  field: PdfField;
  placement: PdfPlacement;
  aliases: PdfPreviewLocationAlias[];
  optionLabels: string[];
};

/** Read-only display projection. Exact physical aliases retain every logical origin. */
export function derivePdfPreviewLocations(fields: readonly PdfField[]): Map<number, PdfPreviewLocation[]> {
  const pages = new Map<number, PdfPreviewLocation[]>();
  const physical = new Map<string, { location: PdfPreviewLocation; optionLabels: Set<string> }>();

  const append = (field: PdfField, fieldNumber: number, placement: PdfPlacement, alias: PdfPreviewLocationAlias) => {
    // Field identity and widget identity remain distinct even at coincident positions.
    // Coordinates use their exact source values; rounding could hide adjacent targets.
    const key = JSON.stringify([field.id, placement.pageIndex, placement.widgetRef, placement.quad.map(point => [point.x, point.y])]);
    let entry = physical.get(key);
    if (!entry) {
      let locations = pages.get(placement.pageIndex);
      if (!locations) {
        locations = [];
        pages.set(placement.pageIndex, locations);
      }
      const location: PdfPreviewLocation = { key, number: locations.length + 1, fieldNumber, field, placement, aliases: [], optionLabels: [] };
      locations.push(location);
      entry = { location, optionLabels: new Set() };
      physical.set(key, entry);
    }
    entry.location.aliases.push(alias);
    if (alias.kind === "option" && !entry.optionLabels.has(alias.label)) {
      entry.optionLabels.add(alias.label);
      entry.location.optionLabels.push(alias.label);
    }
  };

  fields.forEach((field, fieldIndex) => {
    field.placements.forEach((placement, placementIndex) => append(field, fieldIndex + 1, placement, { kind: "direct", placementIndex }));
    field.options.forEach((option, optionIndex) => {
      option.placements.forEach((placement, placementIndex) => append(field, fieldIndex + 1, placement, {
        kind: "option", optionId: option.id, optionIndex, placementIndex, label: option.label
      }));
    });
  });
  return pages;
}
