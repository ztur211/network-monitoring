import { HttpStatus } from '@nestjs/common';
import { NodeScopeException } from '../common/filters/global-exception.filter';

export function assertNameMatchesPolicy(
  name: string,
  policy: { namingPattern: string | null; namingMaxLen: number | null },
): void {
  const maxLen = policy.namingMaxLen ?? 63;
  if (name.length > maxLen) {
    throw new NodeScopeException('ORG_006', 'NAMING_POLICY_VIOLATION', HttpStatus.UNPROCESSABLE_ENTITY);
  }
  if (policy.namingPattern) {
    let re: RegExp;
    try { re = new RegExp(policy.namingPattern); } catch { return; }
    if (!re.test(name)) {
      throw new NodeScopeException('ORG_006', 'NAMING_POLICY_VIOLATION', HttpStatus.UNPROCESSABLE_ENTITY);
    }
  }
}
