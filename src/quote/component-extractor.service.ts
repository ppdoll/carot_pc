import { Injectable } from '@nestjs/common';
import { ComponentType, ExtractedComponent, componentTypes } from './types';

interface ComponentSpec {
  type: ComponentType;
  label: string;
  aliases: RegExp[];
  fallbackPatterns: RegExp[];
  classifyPatterns?: RegExp[];
  searchSuffix?: string;
}

const specs: ComponentSpec[] = [
  {
    type: 'cpu',
    label: 'CPU',
    aliases: [/cpu/i, /프로세서/i],
    fallbackPatterns: [
      /인텔\s*i[3579][-\s]?\d{4,5}[a-z]{0,2}\b/i,
      /\b(?:intel\s*)?(?:core\s*)?i[3579][-\s]?\d{4,5}[a-z]{0,2}\b/i,
      /\bxeon\s+[a-z]?\d[-\s]?\d{4}\s*v\d\b/i,
      /\b(?:ryzen|라이젠)\s*[3579]?\s*\d{4}[a-z0-9]*\b/i,
    ],
    classifyPatterns: [/\b(?:ryzen|xeon|intel|core)\b/i, /라이젠|인텔/, /\bi[3579][-\s]?\d{3,5}\b/i],
  },
  {
    type: 'gpu',
    label: 'GPU',
    aliases: [/gpu/i, /vga/i, /그래픽카드/i, /그래픽/i, /글카/i],
    fallbackPatterns: [
      /\b(?:geforce\s*)?(?:rtx|gtx)\s*\d{3,4}(?:\s*(?:ti|super))?(?:\s*\d{1,2}\s*g(?:b)?)?\b/i,
      /\b(?:radeon\s*)?rx\s*\d{4}(?:\s*xt)?\b/i,
    ],
    classifyPatterns: [/\b(?:rtx|gtx|radeon|geforce)\b/i, /지포스|라데온/, /\brx\s*\d{3,4}\b/i],
  },
  {
    type: 'ram',
    label: 'RAM',
    aliases: [/ram/i, /메모리/i],
    fallbackPatterns: [/\bddr[345][-\s]*\d{3,5}\s*\d+\s*g(?:b)?\b/i, /\bddr[345]\s*\d+\s*g(?:b)?\b/i],
    classifyPatterns: [/\bddr[345]\b/i],
    searchSuffix: '메모리',
  },
  {
    type: 'ssd',
    label: 'SSD',
    aliases: [/ssd/i, /저장소/i, /저장장치/i, /스토리지/i],
    fallbackPatterns: [/\b(?:m\.?2\s*)?(?:nvme\s*)?ssd\s*\d+\s*(?:tb|gb|t|g)\b/i],
    classifyPatterns: [/\b(?:m\.?2|nvme|ssd)\b.*\b\d+\s*(?:tb|gb|t|g)\b/i],
    searchSuffix: 'SSD',
  },
  {
    type: 'power',
    label: '파워',
    aliases: [/파워/i, /power/i, /psu/i, /전원장치/i],
    fallbackPatterns: [/정격\s*\d{3,4}\s*w/i, /\d{3,4}\s*w\s*(?:80\s*plus|80\s*브론즈|80\s*골드)?/i],
    classifyPatterns: [/\b\d{3,4}\s*w\b/i, /\b80\s*plus\b/i, /정격|psu/i],
    searchSuffix: '파워',
  },
  {
    type: 'case',
    label: '케이스',
    aliases: [/케이스/i, /case/i],
    fallbackPatterns: [/어항\s*케이스/i, /미들\s*타워/i, /빅\s*타워/i],
    classifyPatterns: [/어항|미들\s*타워|빅\s*타워/],
    searchSuffix: '케이스',
  },
  {
    type: 'motherboard',
    label: 'MB',
    aliases: [/motherboard/i, /\bmainboard\b/i, /\bboard\b/i, /\bmb\b/i, /메인보드/i, /보드/i],
    fallbackPatterns: [/\b(?:h|b|z|x|a)\d{3,4}(?:[a-z]{0,3})\b/i, /\b(?:lga\s*\d+|am[45])\b/i],
    classifyPatterns: [/\b(?:h|b|z|x|a)\d{3,4}[a-z]{0,3}\b/i],
    searchSuffix: 'motherboard',
  },
  {
    type: 'cooler',
    label: 'Cooler',
    aliases: [/cpu\s*cooler/i, /cpu\s*쿨러/i, /cooler/i, /aio/i, /수냉/i, /공랭/i, /쿨러/i],
    fallbackPatterns: [
      /\b(?:ag|ak|pa|nh|kraken|gammaxx|phantom|trinity|ls|le|ml)\s*[a-z0-9-]{2,}\b/i,
      /\b\d{2,3}\s*mm\s*(?:aio|cooler|radiator)\b/i,
    ],
    classifyPatterns: [/\b(?:aio|cooler)\b|수냉|공랭|\bcpu\s*쿨러\b/i],
    searchSuffix: 'cooler',
  },
];

const SECTION_HEADER_PATTERN = /^(?:cpu(?:\s*쿨러|\s*cooler)?|쿨러|cooler|gpu|vga|그래픽카드|그래픽|글카|ram|메모리|ssd|저장소|저장장치|스토리지|파워|power|psu|전원장치|case|케이스|motherboard|메인보드|보드|mainboard|board|mb)$/i;
const NOISE_LINE_PATTERNS = [
  /\(\s*[WDHwdh]\s*\).*\(\s*[WDHwdh]\s*\)/, // dimensions like 220(W)×375(D)
  /^쿨링팬\s*[:：]/, // 쿨링팬 : 후면 140mm...
  /(?:HDD|SSD)\s*베이/i, // HDD 베이 :, SSD 베이
];

@Injectable()
export class ComponentExtractorService {
  extract(description: string): ExtractedComponent[] {
    const preprocessed = this.preprocessText(description);
    const lines = this.toLines(preprocessed);
    const assignedLines = new Set<string>();

    return componentTypes.map((type) => {
      const spec = specs.find((candidate) => candidate.type === type);
      if (!spec) {
        throw new Error(`Unknown component type: ${type}`);
      }

      const labeled = this.extractByLabel(spec, lines);
      if (labeled) {
        assignedLines.add(labeled.line);
        return this.toComponent(spec, labeled.value, 'high', labeled.line);
      }

      const classified = this.extractByLineClassification(spec, lines, assignedLines);
      if (classified) {
        assignedLines.add(classified.line);
        return this.toComponent(spec, classified.value, 'medium', classified.line);
      }

      const fallback = this.extractByFallback(spec, lines, assignedLines);
      if (fallback) {
        assignedLines.add(fallback.line);
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

  private preprocessText(description: string): string {
    const cleaned = description.replace(/\r\n/g, '\n').replace(/[™®©]/g, '');
    const rawLines = cleaned.split('\n');
    const result: string[] = [];

    let i = 0;
    while (i < rawLines.length) {
      const trimmed = this.stripBullet(rawLines[i]);

      if (this.isSectionHeader(trimmed)) {
        let j = i + 1;
        while (j < rawLines.length && rawLines[j].trim() === '') {
          j++;
        }

        if (j < rawLines.length && !this.isSectionHeader(this.stripBullet(rawLines[j]))) {
          const valueLine = this.stripBullet(rawLines[j]);
          result.push(`${trimmed}: ${valueLine}`);
          i = j + 1;
          continue;
        }

        i++;
        continue;
      }

      result.push(rawLines[i]);
      i++;
    }

    return result.join('\n');
  }

  private isSectionHeader(line: string): boolean {
    if (!line) {
      return false;
    }
    return SECTION_HEADER_PATTERN.test(line.trim());
  }

  private isNoiseLine(line: string): boolean {
    return NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line));
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
    if (before && !/^[-*•\s]*$/.test(before)) {
      return null;
    }

    const after = line.slice(match.index + match[0].length).trim();
    const cleaned = this.cleanValue(after.replace(/^[:|,\-\s]+/, '').trim());
    return cleaned ? this.truncateAtCommentary(cleaned) : null;
  }

  private extractByFallback(spec: ComponentSpec, lines: string[], assignedLines: Set<string>) {
    for (const line of lines) {
      const stripped = this.stripBullet(line);
      if (assignedLines.has(stripped) || this.isNoiseLine(stripped)) {
        continue;
      }
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

  private extractByLineClassification(spec: ComponentSpec, lines: string[], assignedLines: Set<string>) {
    if (!spec.classifyPatterns?.length) {
      return null;
    }
    for (const line of lines) {
      const stripped = this.stripBullet(line);
      if (assignedLines.has(stripped) || this.isNoiseLine(stripped)) {
        continue;
      }
      for (const pattern of spec.classifyPatterns) {
        if (pattern.test(stripped)) {
          const truncated = this.truncateAtCommentary(stripped);
          return {
            value: this.cleanValue(truncated),
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
      if (this.isProseToken(token)) {
        break;
      }
      if (this.isSpecToken(token)) {
        kept.push(token);
      }
    }
    const truncated = kept.join(' ').trim();
    return truncated || value;
  }

  private isSpecToken(token: string) {
    if (/[A-Za-z0-9]/.test(token)) {
      return true;
    }

    return /신형|구형|어항|미들|빅|타워|코어|쓰레드|정격|브론즈|골드|실버|화이트|블랙|공랭|수냉|저소음|지포스|라데온|라이젠|인텔|엔비디아|잘만|마이크론|기가바이트|마이크로닉스|시소닉|쿠거|다크플래시|페가서스|텍셀|크루셜|커세어|삼성|하이닉스|에이수스|에이즈락|에이서|기성/.test(
      token,
    );
  }

  private isProseToken(token: string) {
    return /(?:다|요|음|임|입니다|세요|네요|어요|아요)$/.test(token);
  }

  private stripBullet(line: string) {
    return line.replace(/^[-*•·.\s]+/, '').trim();
  }

  private cleanValue(value: string) {
    const cleaned = value
      .replace(/^[:|,\-\s]+/, '')
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
      normalized = normalized.replace(/^지포스\s+/i, 'GeForce ').replace(/^gaming\s+geforce\s+/i, 'GeForce ');
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
