import { Records } from '../../../../features/records';
export default async function Page({ params }: { params: Promise<{ datasetId: string }> }) {
  const { datasetId } = await params;
  return <Records datasetId={datasetId} />;
}
