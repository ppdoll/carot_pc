export interface ComponentKeys {
  cpuKey: string | null;
  ramKey: string | null;
  gpuKey: string | null;
}

export function canonicalCpu(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();

  const xeon = normalized.match(/xeon\s+([a-z]?\d)[-\s]?(\d{4})\s*v\s*(\d)/i);
  if (xeon) {
    return `Xeon ${xeon[1].toUpperCase()}-${xeon[2]} v${xeon[3]}`;
  }

  const intelCore = normalized.match(/\bi([3579])[-\s]?(\d{4,5})([a-z]{0,2})\b/i);
  if (intelCore) {
    return `i${intelCore[1]}-${intelCore[2]}${intelCore[3].toUpperCase()}`;
  }

  const ryzen = normalized.match(/ryzen\s*([3579])\s*(\d{4})([a-z0-9]*)/i);
  if (ryzen) {
    return `Ryzen ${ryzen[1]} ${ryzen[2]}${ryzen[3].toUpperCase()}`;
  }

  return null;
}

export function canonicalRam(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/(\d+)\s*g(?:b)?\b/i);
  if (!match) {
    return null;
  }

  return `${match[1]}GB`;
}

export function canonicalGpu(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();

  const nvidia = normalized.match(/\b(rtx|gtx)\s*(\d{3,4})(\s*(ti|super))?/i);
  if (nvidia) {
    const family = nvidia[1].toUpperCase();
    const number = nvidia[2];
    const suffix = nvidia[4] ? ` ${nvidia[4][0].toUpperCase()}${nvidia[4].slice(1).toLowerCase()}` : '';
    return `${family} ${number}${suffix}`;
  }

  const amd = normalized.match(/\brx\s*(\d{4})(\s*xt)?/i);
  if (amd) {
    const suffix = amd[2] ? ' XT' : '';
    return `RX ${amd[1]}${suffix}`;
  }

  return null;
}
