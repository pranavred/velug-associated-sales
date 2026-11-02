/** Add only images you own or have permission to redistribute. */
export interface PlantPhoto {
  file: string;
  title: string;
  credit: string;
  source: string;
  original: string;
  alt: string;
  note: string;
  markers: Array<{ x: number; y: number; label: string; detail: string }>;
}
export const plantMedia: Array<{ plant_id: string; photos: PlantPhoto[] }> = [];
export const photoFiles = new Set<string>();
