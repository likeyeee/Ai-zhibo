export function ProductCover({ title, imageUrl }: { title: string; imageUrl: string | null }) {
  if (imageUrl) return <img src={imageUrl} alt="" />;
  const mark = [...title][0] ?? '品';
  return (
    <div className="cover-fallback" aria-hidden>
      {mark}
    </div>
  );
}
