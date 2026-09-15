import { DeliveryCopilotIntent, TimeRange } from "./delivery-copilot.types";

interface IntentMatch {
  intent: DeliveryCopilotIntent;
  confidence: number;
}

const INTENT_PATTERNS: Array<{
  intent: DeliveryCopilotIntent;
  patterns: RegExp[];
  confidence: number;
}> = [
  {
    intent: DeliveryCopilotIntent.ORDER_RECOMMENDATION,
    patterns: [
      /(which|what).*(order|delivery).*(best|take|choose|pick|first)/i,
      /recommend.*(order|delivery|next)/i,
      /best order/i,
      /what should i deliver/i,
      /suggest.*(order|deliveries)/i,
    ],
    confidence: 0.9,
  },
  {
    intent: DeliveryCopilotIntent.PRIORITY_ADVICE,
    patterns: [
      /(which|what).*(order|delivery).*(highest priority|urgent|priority)/i,
      /highest priority/i,
      /urgent delivery/i,
      /order priority/i,
    ],
    confidence: 0.95,
  },
  {
    intent: DeliveryCopilotIntent.ACTIVE_WORKLOAD,
    patterns: [
      /how many active/i,
      /active (deliveries|orders|workload)/i,
      /my active/i,
      /current (deliveries|orders)/i,
      /what am i delivering/i,
      /assigned orders/i,
    ],
    confidence: 0.9,
  },
  {
    intent: DeliveryCopilotIntent.DELIVERY_DIRECTIONS,
    patterns: [
      /direction|route|navigation|map|how to reach|where is customer/i,
      /pickup location|delivery location|address/i,
      /delayed delivery|which delivery is delayed/i,
    ],
    confidence: 0.85,
  },
  {
    intent: DeliveryCopilotIntent.INCIDENT_ADVICE,
    patterns: [
      /customer.*(unavailable|not answering|not at home)/i,
      /wrong address/i,
      /cannot contact/i,
      /accident|breakdown|vehicle issue/i,
      /what should i do if/i,
      /damaged package/i,
      /report issue|incident/i,
    ],
    confidence: 0.95,
  },
  {
    intent: DeliveryCopilotIntent.DAILY_SUMMARY,
    patterns: [
      /today.*(deliveries|earnings|summary|completed)/i,
      /how much did i earn/i,
      /completed deliveries/i,
      /show today/i,
      /daily performance/i,
      /my stats/i,
    ],
    confidence: 0.9,
  },
  {
    intent: DeliveryCopilotIntent.CAPACITY_STATUS,
    patterns: [
      /capacity|can i take more|limit|max deliveries/i,
      /am i full|how many can i accept/i,
    ],
    confidence: 0.85,
  },
];

export function detectIntent(query: string): IntentMatch {
  for (const group of INTENT_PATTERNS) {
    for (const pattern of group.patterns) {
      if (pattern.test(query)) {
        return { intent: group.intent, confidence: group.confidence };
      }
    }
  }

  return { intent: DeliveryCopilotIntent.GENERAL_CHAT, confidence: 0.6 };
}

export function detectTimeRange(_query: string): TimeRange {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    start: startOfDay,
    end: now,
    label: "Today",
  };
}
