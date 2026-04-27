import { Injectable } from '@nestjs/common';
import { ComponentType, ExtractedComponent, componentTypes } from './types';

interface ComponentSpec {
  type: ComponentType;
  label: string;
  aliases: RegExp[];
  fallbackPatterns: RegExp[];
  searchSuffix?: string;
}

const specs: ComponentSpec[] = [
  {
    type: 'cpu',
    label: 'CPU',
    aliases: [/cpu/i, /씨피유/i, /프로세서/i],
    fallbackPatterns: [
      /인텔\s*i[3579][-\s]?\d{4,5}[a-z]{0,2}\b/i,
      /\b(?:intel\s*)?(?:core\s*)?i[3579][-\s]?\d{4,5}[a-z]{0,2}\b/i,
      /\bxeon\s+[a-z]?\d[-\s]?\d{4}\s*v\d\b/i,
      /라이젠\s*\d?\s*(?:[3579])?\s*[가-힣a-z]*\s*\d{4}[a-z0-9]*/i,
      /\bryzen\s*[3579]\s*\d{4}[a-z0-9]*/i,
    ],
  },
  {
    type: 'gpu',
    label: 'GPU',
    aliases: [/gpu/i, /vga/i, /그래픽카드/i, /그래픽/i, /글카/i],
    fallbackPatterns: [
      /\b(?:geforce\s*)?(?:rtx|gtx)\s*\d{3,4}(?:\s*(?:ti|super))?(?:\s*\d{1,2}\s*g(?:b)?)?\b/i,
      /\b(?:radeon\s*)?rx\s*\d{4}(?:\s*xt)?\b/i,
    ],
  },
  {
    type: 'ram',
    label: 'RAM',
    aliases: [/ram/i, /램/i, /메모리/i],
    fallbackPatterns: [/\bddr[345]\s*\d+\s*g(?:b)?\b/i],
    searchSuffix: '메모리',
  },
  {
    type: 'ssd',
    label: 'SSD',
    aliases: [/ssd/i, /저장소/i, /저장장치/i, /스토리지/i],
    fallbackPatterns: [/\b(?:m\.?2\s*)?(?:nvme\s*)?ssd\s*\d+\s*(?:tb|gb|t|g)\b/i],
    searchSuffix: 'SSD',
  },
  {
    type: 'power',
    label: '파워',
    aliases: [/파워/i, /power/i, /psu/i],
    fallbackPatterns: [/정격\s*\d{3,4}\s*w/i, /\d{3,4}\s*w\s*(?:80\s*plus|80\s*플러스)/i],
    searchSuffix: '파워',
  },
  {
    type: 'case',
    label: '케이스',
    aliases: [/케이스/i, /case/i],
    fallbackPatterns: [/어항\s*케이스/i, /미들\s*타워/i, /빅\s*타워/i],
    searchSuffix: '케이스',
  },
];

@Injectable()
export class ComponentExtractorService {
  extract(description: string): ExtractedComponent[] {
    const lines = this.toLines(description);

    return componentTypes.map((type) => {
      const spec = specs.find((candidate) => candidate.type === type);
      if (!spec) {
        throw new Error(`Unknown component type: ${type}`);
      }

      const labeled = this.extractByLabel(spec, lines);
      if (labeled) {
        return this.toComponent(spec, labeled.value, 'high', labeled.line);
      }

      const fallback = this.extractByFallback(spec, lines);
      if (fallback) {
        return this.toComponent(spec, fallback.value, 'medium', fallback.line);
      }

      return {
        type: spec.type,
        label: spec.label,
        rawValue: null,
        searchQuery: null,
        detected: false,
        confidence: 'low',
      };
    });
  }

  private extractByLabel(spec: ComponentSpec, lines: string[]) {
    for (const line of lines) {
      const stripped = this.stripBullet(line);
      for (const alias of spec.aliases) {
        if (!alias.test(stripped)) {
          continue;
        }

        alias.lastIndex = 0;
        const value = this.valueAfterAlias(stripped, alias);
        if (value) {
          return { value, line: stripped };
        }
      }
    }

    return null;
  }

  private valueAfterAlias(line: string, alias: RegExp) {
    const match = line.match(alias);
    if (!match || match.index == null) {
      return null;
    }

    const before = line.slice(0, match.index).trim();
    if (before && !/^[-•*·\s]*$/.test(before)) {
      return null;
    }

    const after = line.slice(match.index + match[0].length).trim();
    const cleaned = this.cleanValue(after.replace(/^[:：;,\-\s]+/, '').trim());
    return cleaned ? this.truncateAtCommentary(cleaned) : null;
  }

  private extractByFallback(spec: ComponentSpec, lines: string[]) {
    for (const line of lines) {
      const stripped = this.stripBullet(line);
      for (const pattern of spec.fallbackPatterns) {
        const match = stripped.match(pattern);
        if (match?.[0]) {
          return {
            value: this.cleanValue(match[0]),
            line: stripped,
          };
        }
      }
    }

    return null;
  }

  private toComponent(
    spec: ComponentSpec,
    rawValue: string,
    confidence: ExtractedComponent['confidence'],
    sourceLine: string,
  ): ExtractedComponent {
    const normalized = this.normalizeComponentValue(spec.type, rawValue);

    return {
      type: spec.type,
      label: spec.label,
      rawValue: normalized,
      searchQuery: this.toSearchQuery(spec, normalized),
      detected: Boolean(normalized),
      confidence,
      sourceLine,
    };
  }

  private toLines(description: string) {
    return description
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^\*+\s*\S/.test(line));
  }

  private truncateAtCommentary(value: string) {
    const tokens = value.split(/\s+/);
    const kept: string[] = [];
    for (const token of tokens) {
      if (this.isSpecToken(token)) {
        kept.push(token);
        continue;
      }
      break;
    }
    const truncated = kept.join(' ').trim();
    return truncated || value;
  }

  private isSpecToken(token: string) {
    if (/[A-Za-z0-9]/.test(token)) {
      return true;
    }

    const specKeywords =
      /신형|구형|어항|미들|빅|타워|케이스|코어|스레드|쓰레드|정격|플러스|단일|듀얼|쿼드|옥타|수냉|공랭|저소음|고급/;
    return specKeywords.test(token);
  }

  private stripBullet(line: string) {
    return line.replace(/^[-•*·\s]+/, '').trim();
  }

  private cleanValue(value: string) {
    const cleaned = value
      .replace(/^[:：;,\-\s]+/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (
      (cleaned.startsWith('[') && cleaned.endsWith(']')) ||
      (cleaned.startsWith('(') && cleaned.endsWith(')'))
    ) {
      return cleaned.slice(1, -1).trim();
    }

    return cleaned;
  }

  private normalizeComponentValue(type: ComponentType, value: string) {
    let normalized = value.replace(/\s+/g, ' ').trim();

    if (type === 'cpu') {
      normalized = normalized.replace(/^intel\s+/i, '').replace(/^인텔\s+/i, 'Intel ');
    }

    if (type === 'gpu') {
      normalized = normalized
        .replace(/^지포스\s+/i, 'GeForce ')
        .replace(/^gaming\s+geforce\s+/i, 'GeForce ');
    }

    if (type === 'ram') {
      normalized = normalized.replace(/\b(\d+)\s*g\b/i, '$1GB');
    }

    if (type === 'ssd') {
      normalized = normalized.replace(/\b(\d+)\s*g\b/i, '$1GB').replace(/\b(\d+)\s*t\b/i, '$1TB');
    }

    if (type === 'power') {
      normalized = normalized.replace(/;/g, ':');
    }

    return normalized;
  }

  private toSearchQuery(spec: ComponentSpec, rawValue: string) {
    const sanitized = this.sanitizeForSearch(spec.type, rawValue);

    if (spec.type === 'ram' && /^\d+\s*g(?:b)?$/i.test(sanitized)) {
      return `DDR4 ${sanitized} 데스크탑 메모리`;
    }

    const lower = sanitized.toLowerCase();
    const hasSuffix =
      spec.searchSuffix &&
      (lower.includes(spec.searchSuffix.toLowerCase()) ||
        (spec.type === 'ram' && /\bddr[345]\b/i.test(sanitized)) ||
        (spec.type === 'ssd' && /\bssd\b/i.test(sanitized)));

    if (!spec.searchSuffix || hasSuffix) {
      return sanitized;
    }

    return `${sanitized} ${spec.searchSuffix}`;
  }

  private sanitizeForSearch(type: ComponentType, value: string) {
    let cleaned = value.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');

    if (type === 'gpu') {
      cleaned = cleaned.replace(/\b(?:geforce|radeon|nvidia)\b/gi, ' ');
    }

    return cleaned.replace(/\s+/g, ' ').trim();
  }
}
