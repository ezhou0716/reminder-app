export default function TitleBar() {
  return (
    <div
      className="h-9 bg-berkeley-blue flex items-center px-4 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <span className="text-white text-sm font-semibold tracking-wide">
        Berkeley Calendar
      </span>
    </div>
  );
}
