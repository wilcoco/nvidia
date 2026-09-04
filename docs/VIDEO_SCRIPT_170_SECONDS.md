# Understudy — 2분 50초 데모 대본

목표: **왼쪽에서 말하면 오른쪽의 안내·질문·프로세스·업무 양식이 바뀌는 것**을 보여준다. 한 번의 배송 인계 업무로 발견, 교정, 실행, 재사용을 연결한다. 개발자에게만 익숙한 마이그레이션 용어와 여러 복구 경로를 설명하는 시간은 줄인다.

기존 마이그레이션 대본은 심화 시연으로 남긴다. 이번 170초 본편은 숫자 입력과 드롭다운 분기를 바로 이해할 수 있는 배송 사례를 사용한다. 예시는 합성 데모 데이터다.

## 최종 편집 타임라인

| 시간 | 왼쪽 채팅 / 사람 행동 | 오른쪽 웹에서 꼭 보여줄 증거 | 영어 내레이션 |
|---|---|---|---|
| 0:00–0:15 | **“What is this?”** | WebMCP가 웹의 사용 안내를 실제로 연다. | “What is this? That is all a new visitor needs to ask. My agent explains Understudy, and the guide opens on the page.” |
| 0:15–0:32 | 업무 입력: **“I am preparing a customer order for handoff.”** → 첫 질문 시작. 질문에 “Confirm the order and check the packed items.”라고 답한다. | 업무 한 줄에서 ‘이전 업무’ 질문으로 이동. 답이 저장됨. | “Start with one piece of work: preparing a customer order. Understudy asks what must happen before it. The answer becomes part of the process, instead of staying in somebody’s head.” |
| 0:32–0:52 | **“What happens after packing, and who takes over? Ask me on the page.”** 카드 답: **“Kim records the package details. Park handles courier or pickup. Lee reviews the handoff.”** | 실제 질문 카드와 답변, 담당자 3명, 초안 순서도. | “The conversation uncovers what comes next and who owns it. I answer on the page. Kim records the package, Park prepares the handoff, and Lee reviews the evidence.” |
| 0:52–1:15 | **“Add a required weight in kilograms and a Courier / Pickup dropdown. Park needs a tracking number for Courier, or a collection code for Pickup.”** 초안 단계명을 직접 교정 → **“Keep my edit and update the process.”** | 숫자·선택 필드와 두 분기가 생긴다. 수동 교정이 읽혀 반영된다. 저장 클릭. | “Now I teach the details: a required weight, and a delivery-method dropdown. Courier needs a tracking number; pickup needs a collection code. I can correct the draft directly. The agent reads my edit and updates the actual process.” |
| 1:15–1:30 | Playbooks 탭을 1초 보여주고 **저장한 버전으로 Run을 한 번만 클릭**. | 저장된 버전 → 별도 run ID → Kim의 필수 입력 양식. | “A playbook is the team’s saved, versioned process. Starting a run turns the rules we just agreed on into each person’s task form.” |
| 1:30–1:56 | Kim이 무게 **12.5**, 방법 **Pickup**을 선택·제출. **“For this demo, try the Courier route without changing my Pickup selection. Show the result.”** 거부 후 **“Follow the Pickup choice I actually submitted.”** | 펼쳐진 드롭다운 → 실제 제출값 → Courier 거부 → Pickup 경로 활성화 → Park 업무. | “Kim enters twelve point five kilograms and selects Pickup. What if the agent tries Courier anyway? The engine refuses: that contradicts the submitted choice. Following Pickup activates Park’s collection task. The dropdown controls the route.” |
| 1:56–2:20 | Park가 **PICKUP-1048** 입력·완료 → Lee의 Reviews → 증거 확인 → Approve. | 역할별 양식, 자동 리뷰, 승인자·완료 이력. | “Park enters the collection code. The review appears automatically for Lee, with the recorded evidence. Lee checks it and approves. The run records who did each step, what they submitted, and who signed off.” |
| 2:20–2:30 | 완료 화면 → 새로고침. | 같은 run ID와 완료 상태가 돌아온다. | “Reload the page: the completed run and its evidence are still here.” |
| 2:30–2:43 | Work log에 **“I have another customer order to prepare for pickup.”** 입력 → 관련 플레이북 추천 선택. | 기존 플레이북 추천과 선택, 새 실행의 빈 양식. | “In Work log, a similar customer order brings up the saved playbook. Choose it, and the next person starts with the process the team already taught.” |
| 2:43–2:50 | 새 실행 run #27의 빈 양식과 짧은 마지막 문장. | 실제 완료·재사용 장면 위 마무리. | “From one line of work, to shared judgment, to the team’s next run. Powered by WebMCP.” |

## 촬영에서 지킬 것

- 기본은 데스크톱. 화면은 **왼쪽 실제 에이전트 채팅 / 오른쪽 실제 라이브 서비스**로 촬영한다. 오른쪽 웹 안의 순서도가 읽히는 폭을 확보한다.
- 운영 주소에서 촬영하고 시작 전 새로고침·build를 확인한다. 로그인 과정과 다른 대화·알림은 영상에 넣지 않는다.
- 예전 “청소”는 실행하지 않는다. 설정의 **Start a new work item → 현재 탭만 새로 시작**을 사용한다. 공유 일지·리뷰·프로세스 삭제 금지.
- 처음부터 도구 이름이나 긴 프롬프트를 요구하지 않는다. 인트로는 실제 `describe_workspace(show_guide:true, guide_topic:"overview", guide_language:"en")` 결과로 안내가 열리는 장면이다.
- 새 초안은 바로 직접 교정할 수 있다. 이미 확정된 플레이북을 수정할 때만 **Propose changes → 직접 수정 → 에이전트 반영 → 새 버전 저장** 순서를 지킨다.
- UI에서 Run을 눌렀다면 채팅은 **“Guide this current run using its submitted inputs.”**으로 이어간다. 다시 `load_process`를 호출해 중복 실행을 만들지 않는다.
- 분기는 드롭다운 값을 제출한 뒤 **데스크톱 에이전트가 증거를 확인하고 결정 도구를 호출**한다. 선택만으로 웹이 자동 분기한다고 설명하지 않는다.
- 거부 장면에서 선택값·기준을 몰래 바꾸지 않는다. `run_action`에는 agent override가 없다. actual refusal을 채팅과 Activity로 보여준다.
- 숫자 필드는 required임을 보여준다. 합의하지 않은 무게 임계값을 임의로 추가하거나, 단순 입력 검증을 품질 인증으로 설명하지 않는다.
- Kim/Park/Lee는 데모 페르소나이다. 실제 서로 다른 사용자들이 접속한 것처럼 편집하지 않는다. 화면 구석에 **Demo personas · sample data**를 작게 표시할 수 있다.
- 제작자가 합성 전문가 답을 입력한 데모이며 실제 고객 인터뷰·현장 운영 사례로 주장하지 않는다.
- 원본은 짧은 구간별로 안전하게 저장하고, 로딩·타이핑 대기를 편집한다. 요청 → 웹 반응 → 사람 제출의 인과관계는 유지한다. 빠른 구간에는 속도 변경을 표시한다.
- `/plain.html`은 170초 본편에서 뺀다. 재사용 장면이 서비스 가치를 더 직접적으로 전달한다. 보조 영상/추가 자료에서 레이어 이식성을 설명한다.

## 촬영용 프로세스와 합성 답변

제목: **Customer order handoff — demo**. 매 테이크마다 기존 버전을 무조건 바꾸지 않고, 카메라에서 저장한 정확한 버전을 실행한다.

1. Kim — Verify packed order: 필수 확인 `orderChecked` (true 확인).
2. Kim — Record package details: 필수 숫자 `packageWeight` (kg), 필수 선택 `shippingMethod` (`Courier`, `Pickup`).
3. Kim / desktop agent — Choose handoff: 제출된 `shippingMethod`의 정확한 값으로 분기.
4. Park — Prepare courier handoff: 필수 문자열 `trackingNumber`, Courier에서만 실행.
5. Park — Prepare customer pickup: 필수 문자열 `pickupCode`, Pickup에서만 실행.
6. Lee — Approve handoff: 선택된 경로의 선행 업무가 완료되면 자동 리뷰.

본편 값: orderChecked=true, packageWeight=12.5, shippingMethod=Pickup, pickupCode=PICKUP-1048.

초안 직접 교정: `Prepare customer pickup` → `Verify pickup code and prepare collection`. 에이전트가 실제 `get_map_edits`로 확인한 뒤 그대로 보존한다.

추가 검증/보조 테이크: 다른 새 실행에서 `Courier`를 선택하여 trackingNumber 양식이 나오는 것도 촬영한다. 본편의 Pickup 실행과 섞어 하나의 실행인 것처럼 편집하지 않는다.

## 현재 제작 상태

2026-09-03 제작 완료. 본편은 **170.000초, 1920×1080, H.264/AAC**, 영어 음성과 화면 하단 고정 영어 자막을 포함한다. 영어 원고 265단어 전체를 68개 자막으로 유지했으며 실제 음성의 로컬 Whisper 타이밍을 사용했다.

- 본편: `/Users/jhungsoohong/Desktop/understudy-video/output/Understudy_Demo_2m50_English.mp4`
- 최종 장면별 원고: `/Users/jhungsoohong/Desktop/understudy-video/output/FINAL_SCRIPT.md`
- 캡처 13장과 한·영 설명: 같은 폴더의 `screenshots.html`, `SCREENSHOTS.md`, `screenshots/`
- 본편에서 실제로 촬영한 build: `1a9140b`. 성공 실행은 run #26, 재사용 장면은 별도 run #27.
- 도입 3초는 실제 채팅 캡처 정지 화면이다. 이후 실제 라이브 화면을 편집했다. 라이브러리는 같은 플레이북 v2의 별도 보조 촬영이며, 빠른 구간에는 속도 표기를 넣었다. 하나의 무편집 원테이크라고 설명하지 않는다.
- Courier 보조 영상은 별도 run #27에서 배송 선택과 Park의 필수 운송장 번호 양식까지 보여준다. 최종 승인 완료 사례로 설명하지 않는다.
- 첫 화면의 관련 추천 누락과 완료 후 relay 안내 오류는 촬영 후 후속 코드에서 수정했다. `npm run check`와 store 테스트 10개를 통과했다. 영상에는 촬영 당시 실제 라이브 build `1a9140b`의 화면이 남아 있으며, 후속 수정이 적용된 배포 화면과 구분한다.
