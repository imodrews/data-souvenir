import { createClient } from "../../../lib/supabase/client";
import RecordScan from "../../components/RecordScan";

type ArtworkPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ArtworkPage({
  params,
}: ArtworkPageProps) {
  const { id } = await params;

  const supabase = createClient();

  const { data: artwork, error } = await supabase
    .from("artworks")
    .select("*")
    .eq("id", id)
    .single();

  console.log("Artwork:", artwork);

  return (
    <main>
      <RecordScan artworkId={id} />
      <h1>{artwork.title}</h1>
      <p>Artist: {artwork.artist_name}</p>
      <p>Description: {artwork.description}</p>
      <p>Year: {artwork.year}</p>
      <p>Medium: {artwork.medium}</p>
      <p>Dimensions: {artwork.dimensions}</p>   
    </main>
  );
}