import ArtworkVisit from "../../components/ArtworkVisit";

type ArtworkPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ArtworkPage({
  params,
}: ArtworkPageProps) {
  const { id } = await params;
  return <ArtworkVisit artworkId={id} />;
}