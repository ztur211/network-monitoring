import { useEffect, useMemo, useState, Fragment } from 'react';
import { useViewportStore } from '../../stores/viewport-store';
import type { ElementProperties } from '../ifc/ifc-types';
import { buildGuidByExpressId, buildIfcLinkIndex, deviceForElement } from '../nodes/element-link';
import { DeviceDetails } from './DeviceDetails';
import { DeviceTelemetry } from './DeviceTelemetry';

export function Inspector() {
  const { model, selection, devices, selectNode, isolate, hideElement, requestFocus } = useViewportStore();
  // Spec 4: the Inspector's element branch reads the tagged selection; the device branch
  // (selection.kind === 'device') is rendered by DeviceDetails in Phase D — here it is null.
  const expressID = selection?.kind === 'element' ? selection.expressID : null;
  const [props, setProps] = useState<ElementProperties | null>(null);

  // If this BIM element is linked to a network device (by its GlobalId), offer a jump to it.
  const guidByExpressId = useMemo(() => (model ? buildGuidByExpressId(model) : null), [model]);
  const linkedDevice =
    expressID != null && guidByExpressId
      ? deviceForElement(buildIfcLinkIndex(devices), guidByExpressId, expressID)
      : undefined;

  useEffect(() => {
    let live = true;
    if (model && expressID != null) {
      model.getProperties(expressID).then((p) => {
        if (live) setProps(p);
      });
    } else {
      setProps(null);
    }
    return () => {
      live = false;
    };
  }, [model, expressID]);

  // Spec 4 §7: the unified Inspector switches on selection.kind.
  if (selection?.kind === 'device')
    return (
      <>
        <DeviceDetails />
        <DeviceTelemetry />
      </>
    );
  if (expressID == null || !props) return null;
  return (
    <aside aria-label="inspector" style={{ overflow: 'auto' }}>
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
      {linkedDevice && (
        <p role="status">
          Network device: {linkedDevice.name}{' '}
          <button onClick={() => selectNode(linkedDevice.id)}>Show device</button>
        </p>
      )}
      <div>
        <button onClick={() => isolate(expressID)}>Isolate</button>
        <button onClick={() => hideElement(expressID)}>Hide</button>
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
