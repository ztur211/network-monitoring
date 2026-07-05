import type { DeviceStatusEmit, MonitoringEmitter } from '../monitoring/ingest/ingest.service';

/** Fans the monitoring emit to N sinks (realtime gateway + alert evaluator). */
export class CompositeMonitoringEmitter implements MonitoringEmitter {
  constructor(private readonly delegates: MonitoringEmitter[]) {}
  emitDeviceStatus(p: DeviceStatusEmit): void {
    for (const d of this.delegates) d.emitDeviceStatus(p);
  }
}
