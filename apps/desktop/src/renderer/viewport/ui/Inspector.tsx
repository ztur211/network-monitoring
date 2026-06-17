import { useEffect, useState, Fragment } from 'react';
import { useViewportStore } from '../../stores/viewport-store';
import type { ElementProperties } from '../ifc/ifc-types';

export function Inspector() {
  const { model, selection, isolate, hideElement, requestFocus } = useViewportStore();
  const [props, setProps] = useState<ElementProperties | null>(null);

  useEffect(() => {
    let live = true;
    if (model && selection != null) {
      model.getProperties(selection).then((p) => {
        if (live) setProps(p);
      });
    } else {
      setProps(null);
    }
    return () => {
      live = false;
    };
  }, [model, selection]);

  if (selection == null || !props) return null;
  return (
    <aside
      aria-label="inspector"
      style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 300, overflow: 'auto' }}
    >
      <h3>{props.name ?? props.ifcType}</h3>
      <dl>
        <dt>Type</dt>
        <dd>{props.ifcType}</dd>
        {props.tag && (
          <>
            <dt>Tag</dt>
            <dd>{props.tag}</dd>
          </>
        )}
      </dl>
      <div>
        <button onClick={() => isolate(selection)}>Isolate</button>
        <button onClick={() => hideElement(selection)}>Hide</button>
        <button onClick={() => requestFocus()}>Zoom to</button>
      </div>
      {props.propertySets.map((ps) => (
        <section key={ps.name}>
          <h4>{ps.name}</h4>
          <dl>
            {ps.props.map((p) => (
              <Fragment key={p.name}>
                <dt>{p.name}</dt>
                <dd>{p.value}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ))}
    </aside>
  );
}
