import { Injectable } from '@nestjs/common';

const SERVICE_KEY = '18d9b856fdfa9b9d33e494e66cb981bd9ff4f7bbc61d281293ef8fdafec6fc52';
const BASE = 'https://apis.data.go.kr/B551182';

export interface Hospital {
  ykiho: string;
  yadmNm: string;
  addr: string;
  telno: string;
  clCdNm: string;
  sidoCdNm: string;
  sgguCdNm: string;
  emdongNm: string;
  xPos: number | null;
  yPos: number | null;
  drTotCnt: number;
  mdeptSdrCnt: number;
  hasSpecialist: boolean;
}

export interface DrugInfo {
  ykiho: string;
  antibioticRate: number | null;
  injectionRate: number | null;
  drugItemCnt: number | null;
}

export interface AsmInfo {
  ykiho: string;
  asmGrd07: string | null;
  asmGrd08: string | null;
  asmGrd09: string | null;
}

export interface DiseaseInfo {
  diseaseCode: string;
  diseaseNm: string;
}

@Injectable()
export class HospitalClientService {
  async searchHospitals(params: {
    sidoCd?: string;
    sgguCdNm?: string;
    emdongNm?: string;
    yadmNm?: string;
    dgsbjtCd?: string;
    pageNo?: number;
    numOfRows?: number;
  }): Promise<{ hospitals: Hospital[]; totalCount: number }> {
    const q = new URLSearchParams({
      ServiceKey: SERVICE_KEY,
      _type: 'json',
      pageNo: String(params.pageNo ?? 1),
      numOfRows: String(params.numOfRows ?? 20),
    });
    if (params.sidoCd) q.set('sidoCd', params.sidoCd);
    if (params.sgguCdNm) q.set('sgguCdNm', params.sgguCdNm);
    if (params.emdongNm) q.set('emdongNm', params.emdongNm);
    if (params.yadmNm) q.set('yadmNm', params.yadmNm);
    if (params.dgsbjtCd) q.set('dgsbjtCd', params.dgsbjtCd);

    const url = `${BASE}/hospInfoServicev2/getHospBasisList?${q}`;
    let data: unknown;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      throw new Error(`병원 검색 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    }

    const body = (data as any)?.response?.body;
    const totalCount: number = Number(body?.totalCount ?? 0);
    const raw = body?.items?.item;
    if (!raw) return { hospitals: [], totalCount };

    const items: unknown[] = Array.isArray(raw) ? raw : [raw];
    const hospitals: Hospital[] = items.map((item: any) => ({
      ykiho: String(item.ykiho ?? ''),
      yadmNm: String(item.yadmNm ?? ''),
      addr: String(item.addr ?? ''),
      telno: String(item.telno ?? ''),
      clCdNm: String(item.clCdNm ?? ''),
      sidoCdNm: String(item.sidoCdNm ?? ''),
      sgguCdNm: String(item.sgguCdNm ?? ''),
      emdongNm: String(item.emdongNm ?? ''),
      xPos: item.XPos != null && item.XPos !== '' ? Number(item.XPos) : null,
      yPos: item.YPos != null && item.YPos !== '' ? Number(item.YPos) : null,
      drTotCnt: Number(item.drTotCnt ?? 0),
      mdeptSdrCnt: Number(item.mdeptSdrCnt ?? 0),
      hasSpecialist: Number(item.mdeptSdrCnt ?? 0) > 0,
    }));

    return { hospitals, totalCount };
  }

  async getDrugInfo(ykiho: string): Promise<DrugInfo> {
    const q = new URLSearchParams({
      ServiceKey: SERVICE_KEY,
      _type: 'json',
      ykiho,
      pageNo: '1',
      numOfRows: '1',
    });
    const url = `${BASE}/msupUserInfoService1.2/getMsupUserInfo?${q}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return emptyDrug(ykiho);

      const data: any = await res.json();
      const item = data?.response?.body?.items?.item;
      const first = Array.isArray(item) ? item[0] : item;

      return {
        ykiho,
        antibioticRate: first?.antibioticRate != null ? Number(first.antibioticRate) : null,
        injectionRate: first?.injectionRate != null ? Number(first.injectionRate) : null,
        drugItemCnt: first?.drugItemCnt != null ? Number(first.drugItemCnt) : null,
      };
    } catch {
      return emptyDrug(ykiho);
    }
  }

  async searchDiseases(query: string): Promise<DiseaseInfo[]> {
    if (!query.trim()) return [];
    const q = new URLSearchParams({
      ServiceKey: SERVICE_KEY,
      _type: 'json',
      pageNo: '1',
      numOfRows: '15',
      diseaseNm: query.trim(),
    });
    const url = `${BASE}/diseaseInfoService1/getDiseaseList?${q}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return [];
      const data: any = await res.json();
      const raw = data?.response?.body?.items?.item;
      if (!raw) return [];
      const items: unknown[] = Array.isArray(raw) ? raw : [raw];
      return items.map((item: any) => ({
        diseaseCode: String(item.diseaseCode ?? ''),
        diseaseNm: String(item.diseaseNm ?? ''),
      }));
    } catch {
      return [];
    }
  }

  async getHospAsmInfo(ykiho: string): Promise<AsmInfo> {
    const q = new URLSearchParams({
      ServiceKey: SERVICE_KEY,
      _type: 'json',
      ykiho,
      pageNo: '1',
      numOfRows: '1',
    });
    const url = `${BASE}/hospAsmInfoService1/getHospAsmInfo1?${q}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return emptyAsm(ykiho);
      const data: any = await res.json();
      const item = data?.response?.body?.items?.item;
      const first = Array.isArray(item) ? item[0] : item;
      return {
        ykiho,
        asmGrd07: first?.asmGrd07 ? String(first.asmGrd07) : null,
        asmGrd08: first?.asmGrd08 ? String(first.asmGrd08) : null,
        asmGrd09: first?.asmGrd09 ? String(first.asmGrd09) : null,
      };
    } catch {
      return emptyAsm(ykiho);
    }
  }
}

function emptyAsm(ykiho: string): AsmInfo {
  return { ykiho, asmGrd07: null, asmGrd08: null, asmGrd09: null };
}

function emptyDrug(ykiho: string): DrugInfo {
  return { ykiho, antibioticRate: null, injectionRate: null, drugItemCnt: null };
}
