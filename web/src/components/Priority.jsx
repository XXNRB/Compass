const LABELS = {
  5: 'Critical',
  4: 'High',
  3: 'Medium',
  2: 'Low',
  1: 'Minimal',
};

export function clampPriority(priority) {
  return Math.min(5, Math.max(1, Number(priority) || 1));
}

// Signal-strength style indicator with a text label, so priority never
// depends on colour alone. Colours come from [data-level] in styles.css.
export function PriorityTag({ priority }) {
  const level = clampPriority(priority);

  return (
    <span className="priority" data-level={level} title={`Priority ${level} of 5`}>
      <span className="priority-bars" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((bar) => (
          <i key={bar} className={bar <= level ? 'on' : ''} />
        ))}
      </span>
      {LABELS[level]}
    </span>
  );
}
