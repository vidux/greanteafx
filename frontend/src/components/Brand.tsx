/** Logo mark, name and a subtitle. Shared by the console, the loading cover and the guide. */
export function Brand({ subtitle, heading = false }: { subtitle: string; heading?: boolean }) {
  const Name = heading ? 'h1' : 'span';
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        G
      </span>
      <span className="brand-text">
        <Name className="brand-name">GreanTeaFX</Name>
        <span className="brand-sub">{subtitle}</span>
      </span>
    </div>
  );
}
