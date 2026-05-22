import { Controller, Get, Query, Render } from '@nestjs/common';
import { HospitalClientService, Hospital, DrugInfo, AsmInfo } from './hospital-client.service';

interface HospitalQuery {
  sidoCd?: string;
  sgguCdNm?: string;
  emdongNm?: string;
  dgsbjtCd?: string;
  pageNo?: string;
}

const SIDO_CODES = [
  { code: '110000', name: '서울' },
  { code: '210000', name: '부산' },
  { code: '220000', name: '대구' },
  { code: '230000', name: '인천' },
  { code: '240000', name: '광주' },
  { code: '250000', name: '대전' },
  { code: '260000', name: '울산' },
  { code: '290000', name: '세종' },
  { code: '310000', name: '경기' },
  { code: '320000', name: '강원' },
  { code: '330000', name: '충북' },
  { code: '340000', name: '충남' },
  { code: '350000', name: '전북' },
  { code: '360000', name: '전남' },
  { code: '370000', name: '경북' },
  { code: '380000', name: '경남' },
  { code: '390000', name: '제주' },
];

const DGSBJT_OPTIONS = [
  { code: '', name: '(전체)' },
  { code: '01', name: '내과' },
  { code: '02', name: '신경과' },
  { code: '03', name: '정신건강의학과' },
  { code: '04', name: '외과' },
  { code: '05', name: '정형외과' },
  { code: '06', name: '신경외과' },
  { code: '08', name: '성형외과' },
  { code: '10', name: '산부인과' },
  { code: '11', name: '소아청소년과' },
  { code: '12', name: '안과' },
  { code: '13', name: '이비인후과' },
  { code: '14', name: '피부과' },
  { code: '15', name: '비뇨의학과' },
  { code: '21', name: '재활의학과' },
  { code: '23', name: '가정의학과' },
  { code: '24', name: '응급의학과' },
  { code: '27', name: '치과' },
];

@Controller('hospital')
export class HospitalController {
  constructor(private readonly client: HospitalClientService) {}

  @Get()
  @Render('hospital')
  async index(@Query() query: HospitalQuery) {
    const hasSearch = Boolean(
      query.sidoCd || query.sgguCdNm || query.emdongNm || query.dgsbjtCd,
    );

    let hospitals: Hospital[] = [];
    let totalCount = 0;
    let errorMessage: string | null = null;
    const drugMap = new Map<string, DrugInfo>();
    const asmMap = new Map<string, AsmInfo>();

    if (hasSearch) {
      const pageNo = query.pageNo ? Math.max(1, Number(query.pageNo)) : 1;
      try {
        const result = await this.client.searchHospitals({
          sidoCd: query.sidoCd || undefined,
          sgguCdNm: query.sgguCdNm || undefined,
          emdongNm: query.emdongNm || undefined,
          dgsbjtCd: query.dgsbjtCd || undefined,
          pageNo,
          numOfRows: 20,
        });
        hospitals = result.hospitals;
        totalCount = result.totalCount;

        const [drugResults, asmResults] = await Promise.all([
          Promise.allSettled(hospitals.map((h) => this.client.getDrugInfo(h.ykiho))),
          Promise.allSettled(hospitals.map((h) => this.client.getHospAsmInfo(h.ykiho))),
        ]);
        drugResults.forEach((r, i) => { if (r.status === 'fulfilled') drugMap.set(hospitals[i].ykiho, r.value); });
        asmResults.forEach((r, i) => { if (r.status === 'fulfilled') asmMap.set(hospitals[i].ykiho, r.value); });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : '병원 검색 중 오류가 발생했습니다.';
      }
    }

    const rows = hospitals.map((h) => {
      const drug = drugMap.get(h.ykiho);
      const asm = asmMap.get(h.ykiho);
      return {
        ykiho: h.ykiho,
        yadmNm: h.yadmNm,
        addr: h.addr,
        telno: h.telno,
        clCdNm: h.clCdNm,
        drTotCnt: h.drTotCnt,
        mdeptSdrCnt: h.mdeptSdrCnt,
        hasSpecialist: h.hasSpecialist,
        xPos: h.xPos,
        yPos: h.yPos,
        hasMapCoords: h.xPos != null && h.yPos != null,
        antibioticRate: drug?.antibioticRate != null ? (drug.antibioticRate * 100).toFixed(1) + '%' : null,
        antibioticRateClass: drug?.antibioticRate != null
          ? (drug.antibioticRate >= 0.3 ? 'rate-high' : drug.antibioticRate >= 0.15 ? 'rate-mid' : 'rate-low')
          : '',
        injectionRate: drug?.injectionRate != null ? (drug.injectionRate * 100).toFixed(1) + '%' : null,
        drugItemCnt: drug?.drugItemCnt ?? null,
        asmGrd07: asm?.asmGrd07 ?? null,
        asmGrd07Class: gradeClass(asm?.asmGrd07),
        asmGrd08: asm?.asmGrd08 ?? null,
        asmGrd08Class: gradeClass(asm?.asmGrd08),
        asmGrd09: asm?.asmGrd09 ?? null,
        asmGrd09Class: gradeClass(asm?.asmGrd09),
      };
    });

    const pageNo = query.pageNo ? Number(query.pageNo) : 1;
    const totalPages = Math.ceil(totalCount / 20);
    const prevPage = pageNo > 1 ? pageNo - 1 : null;
    const nextPage = pageNo < totalPages ? pageNo + 1 : null;

    const filterQs = new URLSearchParams();
    if (query.sidoCd) filterQs.set('sidoCd', query.sidoCd);
    if (query.sgguCdNm) filterQs.set('sgguCdNm', query.sgguCdNm);
    if (query.emdongNm) filterQs.set('emdongNm', query.emdongNm);
    if (query.dgsbjtCd) filterQs.set('dgsbjtCd', query.dgsbjtCd);

    return {
      sidoCodes: SIDO_CODES.map((s) => ({ ...s, selected: s.code === query.sidoCd })),
      dgsbjtOptions: DGSBJT_OPTIONS.map((s) => ({ ...s, selected: s.code === query.dgsbjtCd })),
      filter: {
        sidoCd: query.sidoCd || '',
        sgguCdNm: query.sgguCdNm || '',
        emdongNm: query.emdongNm || '',
        dgsbjtCd: query.dgsbjtCd || '',
      },
      hasSearch,
      errorMessage,
      selectedDgsbjtName: DGSBJT_OPTIONS.find((o) => o.code === query.dgsbjtCd)?.name ?? null,
      hospitals: rows,
      totalCount,
      pageNo,
      totalPages,
      prevPage,
      nextPage,
      hasPagination: prevPage !== null || nextPage !== null,
      filterQs: filterQs.toString(),
    };
  }

  @Get('diseases')
  async diseases(@Query('q') q: string) {
    return this.client.searchDiseases(q || '');
  }
}

function gradeClass(grade: string | null | undefined): string {
  if (!grade) return '';
  const n = parseInt(grade, 10);
  if (n === 1) return 'grade-1';
  if (n === 2) return 'grade-2';
  if (n === 3) return 'grade-3';
  if (n === 4) return 'grade-4';
  if (n === 5) return 'grade-5';
  return 'grade-excluded';
}
