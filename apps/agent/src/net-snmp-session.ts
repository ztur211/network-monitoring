/**
 * Real net-snmp session adapter.
 *
 * Wraps the callback-based net-snmp library into the SnmpSession interface
 * expected by snmpCollector.  net-snmp ships no TypeScript declarations, so
 * `any` casts are intentional and unavoidable in this file.
 *
 * This module is NOT unit-tested — the snmpCollector is tested via a fake
 * session (see snmp-collector.spec.ts).  Runtime correctness is verified by
 * manual gear testing against a real SNMP target.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const snmp = require('net-snmp') as any;

import type { SnmpTargetDto } from '@nodescope/shared';
import type { SnmpSession, SnmpSessionFactory } from './collectors/snmp-collector.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a net-snmp varbind value to a plain number.
 * 64-bit Counter64 values are returned by net-snmp as a Buffer; we decode
 * them to a BigInt then to a Number (precision loss possible for very large
 * counters, but acceptable for metric purposes).
 */
function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  // Counter64 comes back as a Buffer in net-snmp
  if (Buffer.isBuffer(value)) {
    let big = BigInt(0);
    for (const byte of value) {
      big = (big << BigInt(8)) + BigInt(byte);
    }
    return Number(big);
  }
  return Number(value);
}

/**
 * Extract the last numeric segment from an OID string.
 * e.g. "1.3.6.1.2.1.31.1.1.1.6.3" → "3"
 */
function lastOidSegment(oid: string): string {
  const parts = oid.split('.');
  return parts[parts.length - 1] ?? oid;
}

/** Map from our SnmpTargetDto auth-protocol string to net-snmp's AuthProtocols constant. */
function authProtocol(proto: string | undefined): number {
  switch ((proto ?? '').toLowerCase()) {
    case 'md5': return snmp.AuthProtocols.md5 as number;
    case 'sha': return snmp.AuthProtocols.sha as number;
    case 'sha224': return snmp.AuthProtocols.sha224 as number;
    case 'sha256': return snmp.AuthProtocols.sha256 as number;
    case 'sha384': return snmp.AuthProtocols.sha384 as number;
    case 'sha512': return snmp.AuthProtocols.sha512 as number;
    default: return snmp.AuthProtocols.none as number;
  }
}

/** Map from our SnmpTargetDto priv-protocol string to net-snmp's PrivProtocols constant. */
function privProtocol(proto: string | undefined): number {
  switch ((proto ?? '').toLowerCase()) {
    case 'des': return snmp.PrivProtocols.des as number;
    case 'aes':
    case 'aes128': return snmp.PrivProtocols.aes as number;
    case 'aes256b': return snmp.PrivProtocols.aes256b as number;
    case 'aes256r': return snmp.PrivProtocols.aes256r as number;
    default: return snmp.PrivProtocols.none as number;
  }
}

/** Map from our SnmpTargetDto securityLevel string to net-snmp's SecurityLevel constant. */
function securityLevel(level: string | undefined): number {
  switch ((level ?? '').toLowerCase()) {
    case 'authpriv':
    case 'authprivacy': return snmp.SecurityLevel.authPriv as number;
    case 'authnopriv':
    case 'authnoprivacy': return snmp.SecurityLevel.authNoPriv as number;
    default: return snmp.SecurityLevel.noAuthNoPriv as number;
  }
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

/**
 * Build a real SnmpSession backed by net-snmp for the given SnmpTargetDto.
 */
function buildSession(target: SnmpTargetDto, host: string): SnmpSession {
  let rawSession: any;

  if (target.version === 'V3') {
    const user = {
      name: target.securityName ?? '',
      level: securityLevel(target.securityLevel),
      authProtocol: authProtocol(target.authProtocol),
      authKey: target.authKey ?? '',
      privProtocol: privProtocol(target.privProtocol),
      privKey: target.privKey ?? '',
    };
    rawSession = snmp.createV3Session(host, user, { version: snmp.Version3 });
  } else {
    // V2C (default)
    rawSession = snmp.createSession(host, target.community ?? 'public', {
      version: snmp.Version2c,
    });
  }

  return {
    get(oids: string[]): Promise<Record<string, unknown>> {
      return new Promise((resolve, reject) => {
        rawSession.get(oids, (error: any, varbinds: any[]) => {
          if (error) { reject(error); return; }
          const result: Record<string, unknown> = {};
          for (const vb of varbinds) {
            if (snmp.isVarbindError(vb)) {
              // Skip errored varbinds rather than failing the whole GET
              continue;
            }
            result[vb.oid as string] = toNumber(vb.value);
          }
          resolve(result);
        });
      });
    },

    walkColumn(tableOid: string): Promise<Record<string, unknown>> {
      return new Promise((resolve, reject) => {
        const result: Record<string, unknown> = {};
        rawSession.subtree(
          tableOid,
          // feedCb — called per batch of varbinds
          (varbinds: any[]) => {
            for (const vb of varbinds) {
              if (snmp.isVarbindError(vb)) continue;
              // The ifIndex is the last segment of the OID
              const idx = lastOidSegment(vb.oid as string);
              result[idx] = toNumber(vb.value);
            }
          },
          // doneCb — called once when walk finishes (error | null)
          (error: any) => {
            if (error) { reject(error); return; }
            resolve(result);
          },
        );
      });
    },

    close(): void {
      rawSession.close();
    },
  };
}

/**
 * Real net-snmp session factory.
 *
 * Implements `SnmpSessionFactory = (target, host) => SnmpSession`.
 * The `host` argument is the device IP address, provided by snmpCollector
 * from `device.ipAddress`.
 */
export const netSnmpSessionFactory: SnmpSessionFactory = (
  target: SnmpTargetDto,
  host: string,
): SnmpSession => {
  return buildSession(target, host);
};
