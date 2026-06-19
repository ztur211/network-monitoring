import { useSitesStore } from '../stores/sites-store';
import { useViewportStore } from '../stores/viewport-store';

// The F2 site/building tree. Selecting a building sets it active (the viewport reads it).
export function Sidebar() {
  const { properties, selectedBuildingId, selectBuilding } = useSitesStore();
  const setActive = useViewportStore((s) => s.setActiveBuilding);
  const sites = properties.filter((p) => p.type === 'SITE');

  return (
    <nav aria-label="Sites">
      {sites.map((site) => (
        <div key={site.id}>
          <div>{site.name}</div>
          {properties
            .filter((p) => p.parentId === site.id && p.type === 'BUILDING')
            .map((b) => (
              <button
                key={b.id}
                data-selected={b.id === selectedBuildingId}
                onClick={() => {
                  selectBuilding(b.id);
                  setActive(b.id);
                }}
              >
                {b.name}
              </button>
            ))}
        </div>
      ))}
    </nav>
  );
}
