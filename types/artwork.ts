export type Artwork = {
  id: string;
  artist_id: string;
  title: string;
  year: string | null;
  floor: string | null;
  x: number | null;
  y: number | null;
  image_url: string | null;
  nfc_code: string | null;
  exhibition_number: number | null;
  material_de: string | null;
  material_eng: string | null;
  text_de: string | null;
  text_eng: string | null;
  additional_material: string | null;
  notes: string | null;
};