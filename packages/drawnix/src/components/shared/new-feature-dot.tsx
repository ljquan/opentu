import './new-feature-dot.scss';

export function NewFeatureDot({ corner = false }: { corner?: boolean }) {
  return (
    <span
      className={`new-feature-dot${corner ? ' new-feature-dot--corner' : ''}`}
      aria-hidden="true"
    />
  );
}
