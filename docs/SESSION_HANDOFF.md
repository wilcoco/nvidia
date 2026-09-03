# Understudy — 세션 핸드오프 메모 (2026-09-03, 후속 UX 검증 갱신)

다른 세션/에이전트가 이 프로젝트를 이어받기 위한 단일 문서.
저장소: github.com/wilcoco/nvidia (public, MIT)

> **최신 상태:** 이전 무결성 수정 17개 파일은 `93a73e9`로 사용자가 목적지·범위를 명시 승인한 후 푸시했다.
> 그 이후의 제품 경험 개선도 사용자의 추가 푸시 요청으로 이번 커밋에 포함했다. 운영 배포 완료 여부는 별도 확인이 필요하며, 아래 13:50 배포 기록은 과거 이력이다.
> 사용자가 강조한 가치는 **업무 입력 → 앞뒤 업무 질문·답변 → 프로세스 구성 → 담당자별 실행 → 관련 업무 재사용 → 사람의 검토를 거친 개정**이다.
> 기본은 데스크톱이며 오른쪽 그래픽을 숨기지 않는다. 새로 만들기와 기존 플레이북 사용을 명시적으로 구분한다. 별도 챗봇을 만든 것이 아니라 방문자의 WebMCP 에이전트를 사용한다.
> 타입 검사·빌드, SDK/스토어/메모리/PostgreSQL 회귀 19개가 통과했다. 실제 WebMCP 브라우저로 생성·교정·실패 분기·재작업·승인·재사용·개정을 확인했다.
> [최신 UX 개선·검증 보고서](UX_IMPROVEMENTS_2026-09-03.md)를 먼저 읽고, 이전 서버 무결성 수정은 [심사·검증 보고서](JUDGING_REVIEW_2026-09-03.md)를 참고할 것.
> 로컬 미리보기는 18987 포트 메모리 서버이며 테스트 자료가 있다. 이번 후속 검증에서 운영 데이터와 배포는 변경하지 않았다.

## 0. 최종 커밋·배포 상태 (13:50 KST 검증)

- 로컬 HEAD = origin/main = **`7816808`** `[09-03 13:44 #117]` — 미푸시 커밋 0.
- 라이브 사이트도 **`7816808`** 서빙 확인(헤더 build sha + 번들 grep).
- 크래시 가드 라이브 재현 검증: 비정수 id POST → `{"error":"invalid_id"}` 400,
  직후 /api/state 200 (프로세스 생존).

## 0-1. 코드 감사 15건 처리 결과 (13:44 배포분)

| 결함 | 처리 | 비고 |
|---|---|---|
| R12 폴링이 질문 답변 입력 삭제 | ✅ 수정 | ask id별 draft 맵 보존 — 촬영 T1 필수 수정 |
| R10 비정수 id → 프로세스 사망 | ✅ 수정 | intParam 400 + 에러넷 + unhandledRejection 로그. **라이브 재현 검증 완료** |
| R11 동시 제출 중복 리뷰 / approve+reject 동시 성공 | ✅ 수정 | 워크로그당 pending 1건(409 duplicate_review) + decide 조건부 UPDATE(status='PENDING', 패자 409 already_decided) |
| prior-1 steps:[]로 필수 단계 삭제 | ✅ 수정 | 기존 steps 있으면 빈 배열 거부 |
| prior-2 타 런 승인이 액션명만으로 단계 완료 | ✅ 수정 | HostAction.selfReporting — notifyAction 자체보고 액션 5종은 러너 자동기록 제외 |
| prior-4 재작업 성공이 dedupe로 무시 | ✅ 수정 | 액션에 바인딩된 미완료 단계가 있으면 재기록 허용 |
| prior-5 낡은 승인 카드 무검증 실행 | ✅ 수정 | 실행 직전 prerequisiteGap+precondition 재검증, 위반 시 Stale approval 거부 |
| R6 빈 DB에서 기본 계정 누락 | ✅ 수정 | SEED 사용자별 개별 존재검사·삽입 |
| prior-7 액션 성공이 증빙 검사 생략 | ✅ 수정 | required/confirm 필드나 단일간선 exit criteria 있는 단계는 자동완료 거부, 태스크 카드로 유도 저널 |
| R8 최신 200건 창으로 불변성 검사 | ✅ 수정 | db.getWorklog(id) 직접 조회로 교체(3개 라우트) |
| R15 N/A·conditional 단계 체크 완료 | ✅ 수정 | 엔진 거부 + UI 체크박스 잠금 이중 |
| R13 로그아웃 후 늦은 응답이 상태 부활 | ✅ 수정 | sessionGen 세대 가드 + 로그아웃 시 사용자 상태 전체 청소 |
| R14 저장 실패가 confirmed 유지 | ✅ 수정 | saver 실패 시 confirmed=false 복귀 + 저널 "back to draft" |
| R9 startRun 응답 역전으로 런 혼입 | ✅ 수정 | startSeq 시퀀스 가드, 늦은 응답 무시 |
| prior-3 실계정 분리 시 승인→런 동기화 403 | ⏸ 보류 | 데모·심사는 단일 judge 로그인이라 발생 경로 없음. 근본 해결은 승인 라우트의 서버측 런 수렴(§5 참고). 다계정 운영 전 필수 |

재검증: R10만 라이브 재현으로 확정. 나머지는 tsc+빌드+코드경로 확인
수준 — **`7816808` 기준 브라우저 재감사는 미실시** (다음 세션 1순위).

## 0-2. 시연 필수 조건

- 베이스 플레이북: **"Customer-table staging migration with remediation" v6 (id 53)**
  — 역할(C/O/R)·단계별 필드 완비, 드라이런 없음(촬영 중 가르쳐 추가하는 각본).
  삭제 금지. 시연 라이브러리 13종 유지.
- 촬영 전 청소: QA 플레이북(id65·66·67 등 'QA'/'E2E' 제목) DELETE +
  `/api/admin/reset {scope:'worklogs'}`. **아직 미실행** — 감사 fixture
  (런 #1~#5, 일지 #2~#8)가 프로드에 남아 있음.
- 데모 영상: **아직 미촬영**. 계획 폴더 `~/Desktop/understudy-video/`
  (T1~T4.mov) — 현재 폴더 없음. 각본=docs/SHOOTING_CUESHEET.md.
  편집(Descript, AI 내레이션)→YouTube 공개→Devpost 폼이 남은 임계 경로.

## 1. 무엇을 만들었나

**Understudy** — WebMCP Challenge(webmcp.devpost.com) 출품작.
드롭인 WebMCP 레이어(스크립트 한 줄): 에이전트가 사람의 웹 업무를
관찰하고, 인터뷰로 암묵지를 추출해 프로세스 맵으로 정립하고, 버전
플레이북으로 저장하고, 다음 실행에서 역할별로 업무를 배정·게이트·승인까지
운영한다. 마감: **2026-09-03 13:00 PDT = 09-04 05:00 KST**.

- 라이브: https://nvidia-production-f205.up.railway.app (judge/webmcp2026,
  페르소나 kim=Contributor·park=Operations·lee=Reviewer, linepulse)
- 보조 호스트: /plain.html (프레임워크 없음 — 레이어 이식성 증명)
- 헤더의 `build <sha7>`로 배포 확인. index.html no-store / understudy.js
  no-cache / 해시 자산 immutable.

## 2. 구조

```
sdk/        WebMCP 레이어 (esbuild → public/understudy.js, IIFE)
  tools.ts    20개 툴 등록 (document.modelContext.registerTool + provideContext 폴백)
  mapstore.ts 프로세스 엔진: 상태머신, 분기/루프백, 결정 검증, 갭 인터뷰
  runner.ts   액션 실행 (검증, 승인 게이트, 역할 게이트, runAsHuman)
  asks.ts     비동기 질문/승인 카드 (pending id + 폴링; ~20s 타임아웃 대응)
  panel.ts    섀도우DOM 패널: 미니 순서도+스텝 카드, 편집, 카드, 저널
  runsync.ts  런 영속화 (완결은 즉시 sync, 그 외 700ms 디바운스)
src/        데모 워크스페이스 (React+Vite): My tasks, Reviews, Playbooks, Demo mode
server/     Express+pg(Railway, 메모리 폴백): 인증, 일지/리뷰/플레이북/런
docs/       SUBMISSION.md(제출문) · KEY_STRENGTHS.md(특장점 12 정본)
            · SHOOTING_CUESHEET.md(촬영 큐시트 최종) · SESSION_HANDOFF.md(본 문서)
```

## 3. 핵심 설계 결정 (바꾸기 전에 이유를 알 것)

- **API 키 0개**: 페이지는 툴만 제공, 두뇌는 방문자의 에이전트(ChatGPT/Gemini).
- **비동기 카드**: 에이전트 런타임 툴 타임아웃(~20s) 때문에 ask_user/run_action은
  pending id 반환 → get_question_result/get_action_result 폴링.
- **결정(decision) 해소는 에이전트 전용**: resolve_decision이 곧 증거 검증
  관문(evidence_conflict) — 화면 버튼은 우회 뒷문이라 의도적으로 없음.
- **제출값이 정본**: 담당자가 단계에 제출한 resultData가 판정의 기준.
  에이전트 주장값이 모순되면 거부. 결정 노드/단일 간선 태스크 exit 기준 모두 강제.
- **루프백 = 재시도**: 결정형·작업형 뒤로 가는 간선 모두 루프 몸통 재개 +
  내부 결정 invalidate. 진행도 기준선은 **활성 경로의 완료만** 계산
  (비활성 분기의 done이 skipped 오염을 만들던 버그의 수정 지점).
- **단일 활성 런 + 사인오프 대기 보존**: 새 런 시작 시 3분류 — 열린 작업
  있으면 abandoned(+리뷰 CANCELLED), 전부 완료면 completed, 사인오프만
  남으면 ACTIVE 유지(다중 pending 지원). 취소 경고는 실제 대상만 2클릭 확인.
- **자동 리뷰**: 사인오프 단계 도달 시 완결 기록 일지(Contributor 명의,
  제출값 증거 포함) + pending 리뷰 자동 생성. 런의 draft(합성 포함)가
  대상; systemGenerated가 draft를 지나야만 억제.
- **승인 후 동결**: approved_immutable(서버) + 완결 런 단계/deviation 동결(엔진).
- **역할**: 액션 roles[], 단계 role, 서버측 승인자 검증(실존 Reviewer·작성자
  금지·actingAs 필수). 페르소나는 데모 장치임을 문서에 선언(트러스트 모델).
- **복원**: 서버의 최신 non-abandoned 런 기준(active 우선), 귀속·제출값·결정
  포함. 리로드로 새 런을 몰래 만들지 않음.
- **네이티브 다이얼로그 금지**: window.confirm이 에이전트 브라우저를 얼림 —
  2클릭 확인 패턴 사용.
- **런 소유권 = 인증 세션**(페르소나 아님) — 페르소나로 startedBy를 잡으면
  sync가 not_run_owner로 조용히 죽는 사고가 있었음.
- **커밋 규칙**: 제목 앞 `[MM-DD HH:MM #N]` (KST, N=rev-list count+1). 푸시는
  사용자 지시에 따름(감사 중 보류 요청 잦음).

## 4. 검증 이력 (외부 AI 감사 다수 라운드)

- ChatGPT/Codex 에이전트가 라이브에서 실클릭+WebMCP 호출로 반복 감사.
  P0·P1을 여러 차례 발견→수정→재검. 마지막 보고(59d9ab7 기준) 본선 모의
  78점, 잔여 P0/P1은 **0282f98에 전부 수정 반영** — 단, 0282f98 라이브
  재검은 아직 미실시(§8 관문 5개 문구가 이 문서 하단에).
- 정직성 규칙: 감사가 라이브 빌드와 로컬 HEAD를 구분함. 재검은 반드시
  헤더 build sha 확인 후 진행시킬 것.

## 5. 남은 일 (마감 순)

1. **7816808 재검** (관문: 코드감사 15건 회귀 + ①양쪽 루프백 — 재개 READY·선판정 거부·늦은
   실패값 우선 ②3경로 자동 리뷰 1건+실패 후 재개 ③완결 런 deviation 거부
   ④chosen에 superseded 없음 ⑤복원 정합)
2. **QA 잔재 청소**: `/api/admin/reset {scope:'worklogs'}` + QA 제목
   플레이북 DELETE (id65~67 등 'QA'/'E2E' 접두). 시연 라이브러리 13종과
   베이스 "Customer-table staging migration with remediation" v6(id53,
   역할·필드 완비, 드라이런 없음 — 촬영 중 가르쳐서 추가하는 게 각본)은 유지.
3. **촬영**: docs/SHOOTING_CUESHEET.md 그대로 (T1 캡처·가르침 / T2 운영
   릴레이 원테이크 / T3 거부 / T4 레이어). ChatGPT 데스크탑 ⌘⇧B, 전체화면
   ⌘⇧5, 마이크 끔(내레이션은 AI 음성), 사이드바 접기.
4. **편집**: Descript — 컷 + AI 영어 내레이션(큐시트 문안) + 자막, 3분 이내.
   규정상 **음성 해설 필수**, 저작권 음악 금지.
5. **제출**: YouTube 공개 업로드 → Devpost 폼(SUBMISSION.md 붙여넣기,
   비디오 URL, repo URL, judge 자격증명 기입, 스크린샷 3~5장).
6. 제출 후 저장소·라이브 **동결** (수정 금지).

## 6. 함정 목록 (재발 방지)

- Gemini 무료키는 모델당 20회/일 — Inspector 리허설은 금방 막힘.
- workwork 저장소 코드는 절대 복사 금지(사내 정보) — 개념만.
- 프로드 청소는 플레이북 계보를 남기고 worklogs 스코프로.
- 감사 발견 데이터(fixture)는 재검 전 삭제하지 말 것.
- src 폴더 일괄 치환 시 JSX 깨짐 잦음 — 블록 단위 python 치환 + tsc 확인.
- Railway 배포 확인은 헤더 build sha 또는 번들 내 sha grep으로.
