import { useViewportStore, type SectionState } from '../../stores/viewport-store';

export function Toolbar() {
  const { model, section, hiddenCategories, requestFit, showAll, setSection, toggleCategory } =
    useViewportStore();
  const cats = model ? [...model.render.categories.values()] : [];
  return (
    <div
      aria-label="viewport-toolbar"
      style={{ position: 'absolute', top: 0, left: 0, right: 300, display: 'flex', gap: 8 }}
    >
      <button onClick={() => requestFit()}>Fit</button>
      <button onClick={() => showAll()}>Show all</button>
      <label>
        <input
          aria-label="Section"
          type="checkbox"
          checked={section.enabled}
          onChange={(e) => setSection({ enabled: e.target.checked })}
        />{' '}
        Section
      </label>
      {section.enabled && (
        <>
          <select
            aria-label="Section axis"
            value={section.axis}
            onChange={(e) => setSection({ axis: e.target.value as SectionState['axis'] })}
          >
            <option>X</option>
            <option>Y</option>
            <option>Z</option>
          </select>
          <input
            aria-label="Section position"
            type="range"
            min={-50}
            max={50}
            step={0.1}
            value={section.constant}
            onChange={(e) => setSection({ constant: Number(e.target.value) })}
          />
        </>
      )}
      <details>
        <summary>Categories</summary>
        {cats.map((cat) => (
          <label key={cat.ifcType} style={{ display: 'block' }}>
            <input
              aria-label={`toggle ${cat.ifcType}`}
              type="checkbox"
              checked={!hiddenCategories.has(cat.ifcType)}
              onChange={() => toggleCategory(cat.ifcType)}
            />
            {` ${cat.ifcType} (${cat.ranges.length})`}
          </label>
        ))}
      </details>
    </div>
  );
}
