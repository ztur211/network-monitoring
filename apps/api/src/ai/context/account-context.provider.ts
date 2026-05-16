import { Injectable } from '@nestjs/common';

const TIER_FEATURES: Record<string, string[]> = {
  PERSONAL_FREE: [
    'Network map with GIS (up to 50 devices)',
    'Device documentation (name, category, location, floor, IP, MAC, notes)',
    'Device connections (Ethernet, Fiber, WiFi, Logical)',
    'Fiber run documentation',
    'ISP circuit documentation',
    'Real-time browser metrics (latency, bandwidth, connection quality)',
    'AI assistant (20 messages/hour, 100/day)',
    'Offline mode with queue replay',
    'Real-time sync across browser tabs',
  ],
  PERSONAL_PAID: [
    'Everything in Free tier',
    'More than 50 devices',
    'Floor plan overlays (planned)',
    'Priority support',
  ],
  ENTERPRISE: [
    'Everything in Personal Paid',
    'Multi-user organizations',
    'Self-hosted AI option',
    'Custom device limits',
    'SSO and RBAC',
  ],
};

const PLANNED_FEATURES = [
  'Desktop Agent for richer device metrics without browser tab open (planned)',
  'Router API integrations — Ubiquiti, MikroTik, Meraki (planned)',
  'Native iOS and Android apps (planned)',
  'Multi-property management (planned)',
  'Floor plan overlays (planned)',
];

@Injectable()
export class AccountContextProvider {
  async getContext(userId: string, userTier: string): Promise<string> {
    const tierKey = userTier in TIER_FEATURES ? userTier : 'PERSONAL_FREE';
    const features = TIER_FEATURES[tierKey] ?? TIER_FEATURES['PERSONAL_FREE'];

    const lines = [
      '## Account Context',
      `Current tier: ${tierKey}`,
      '',
      'Available features:',
      ...features.map((f) => `- ${f}`),
      '',
      'Upcoming features (not yet available — describe as planned, never as available for purchase):',
      ...PLANNED_FEATURES.map((f) => `- ${f}`),
    ];

    return lines.join('\n');
  }
}
