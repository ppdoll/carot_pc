import { ComponentType } from './types';

const brandPattern =
  /(samsung|삼성|sk\s*hynix|하이닉스|micron|마이크론|crucial|corsair|커세어|teamgroup|g\.?skill|essencore|klevv|wd|western\s*digital|seagate|시게이트|kioxia|sandisk|micronics|마이크로닉스|fsp|seasonic|시소닉|superflower|슈퍼플라워|antec|잘만|zalman|darkflash|abko|bravotec|lian\s*li|nzxt|fractal|cooler\s*master|asus|gigabyte|msi|emtek|zotac|galax|sapphire|powercolor|colorful|asrock|deepcool|noctua|thermalright|jonsbo)/i;

const genericCasePattern = /^(?:신형\s*)?(?:어항\s*케이스|미들\s*타워|빅\s*타워|케이스)$/i;
const genericPowerPattern = /^(?:정격\s*)?\d{3,4}\s*w(?:\s*80\s*(?:plus|브론즈|골드))?(?:\s*파워)?$/i;
const genericMotherboardPattern = /^(?:motherboard|mainboard|board|mb|메인보드|보드)$/i;
const genericCoolerPattern = /^(?:cooler|cpu\s*cooler|aio|air\s*cooler|수냉|공랭|쿨러)$/i;
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
    case 'motherboard':
      return hasMotherboardModel(value);
    case 'cooler':
      return hasCoolerModel(value);
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

function hasMotherboardModel(value: string): boolean {
  if (genericMotherboardPattern.test(value)) {
    return false;
  }
  const hasChipsetCode = /\b(?:h|b|z|x|a)\d{3,4}(?:[a-z]{0,3})\b/i.test(value);
  const hasSocket = /\b(?:lga\s*\d+|am[45])\b/i.test(value);
  return hasChipsetCode || hasSocket || brandPattern.test(value) || modelCodePattern.test(value);
}

function hasCoolerModel(value: string): boolean {
  if (genericCoolerPattern.test(value)) {
    return false;
  }
  const hasCoolerCode =
    /\b(?:ag|ak|pa|nh|kraken|gammaxx|phantom|trinity|ls|le|ml)\s*[a-z0-9-]{2,}\b/i.test(value) ||
    /\b\d{2,3}\s*mm\b/i.test(value);
  return hasCoolerCode || brandPattern.test(value) || modelCodePattern.test(value);
}
