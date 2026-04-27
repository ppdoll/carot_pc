import { ComponentType } from './types';

const brandPattern =
  /(삼성|하이닉스|sk\s*hynix|마이크론|micron|crucial|커세어|corsair|팀그룹|teamgroup|g\.?skill|에센코어|essencore|klevv|wd|western\s*digital|seagate|시게이트|키오시아|kioxia|sandisk|샌디스크|마이크로닉스|micronics|fsp|seasonic|시소닉|superflower|슈퍼플라워|antec|안텍|잘만|zalman|darkflash|다크플래쉬|아이구주|앱코|abko|bravotec|브라보텍|lian\s*li|리안리|nzxt|fractal|프렉탈|cooler\s*master|쿨러마스터|asus|기가바이트|gigabyte|msi|이엠텍|emtek|zotac|조텍|galax|갤럭시|sapphire|사파이어|powercolor|컬러풀|colorful)/i;

const genericCasePattern = /^(?:신형\s*)?(?:어항\s*케이스|미들\s*타워|빅\s*타워|케이스)$/i;
const genericPowerPattern = /^(?:정격\s*)?\d{3,4}\s*w(?:\s*80\s*(?:plus|플러스))?(?:\s*파워)?$/i;
const modelCodePattern = /\b[a-z]{1,}[a-z0-9-]*\d[a-z0-9-]*\b/i;

export function hasPreciseUsedMarketModel(type: ComponentType, rawValue: string | null | undefined): boolean {
  const value = String(rawValue ?? '').replace(/\s+/g, ' ').trim();
  if (!value) {
    return false;
  }

  switch (type) {
    case 'cpu':
      return hasCpuModel(value);
    case 'gpu':
      return hasGpuModel(value);
    case 'ram':
      return hasRamModel(value);
    case 'ssd':
      return hasStorageModel(value);
    case 'power':
      return hasPowerModel(value);
    case 'case':
      return hasCaseModel(value);
    default:
      return false;
  }
}

function hasCpuModel(value: string): boolean {
  return (
    /\b(?:intel\s*)?(?:core\s*)?i[3579][-\s]?\d{4,5}[a-z]{0,2}\b/i.test(value) ||
    /\bxeon\s+[a-z]?\d[-\s]?\d{4}\s*v\d\b/i.test(value) ||
    /\b(?:ryzen|라이젠)\s*[3579]?\s*\d{4}[a-z0-9]*\b/i.test(value)
  );
}

function hasGpuModel(value: string): boolean {
  return (
    /\b(?:geforce\s*)?(?:rtx|gtx)\s*\d{3,4}(?:\s*(?:ti|super))?(?:\s*\d{1,2}\s*g(?:b)?)?\b/i.test(value) ||
    /\b(?:radeon\s*)?rx\s*\d{4}(?:\s*xt)?\b/i.test(value)
  );
}

function hasRamModel(value: string): boolean {
  return /\bddr[345]\b/i.test(value) && /\b\d+\s*g(?:b)?\b/i.test(value) && brandPattern.test(value);
}

function hasStorageModel(value: string): boolean {
  const hasCapacity = /\b\d+\s*(?:gb|tb|g|t)\b/i.test(value);
  const hasStorageType = /\b(?:ssd|nvme|m\.?2|sata)\b/i.test(value);
  return hasCapacity && hasStorageType && (brandPattern.test(value) || modelCodePattern.test(value));
}

function hasPowerModel(value: string): boolean {
  if (genericPowerPattern.test(value)) {
    return false;
  }
  return /\b\d{3,4}\s*w\b/i.test(value) && (brandPattern.test(value) || modelCodePattern.test(value));
}

function hasCaseModel(value: string): boolean {
  if (genericCasePattern.test(value)) {
    return false;
  }
  return brandPattern.test(value) || modelCodePattern.test(value);
}
