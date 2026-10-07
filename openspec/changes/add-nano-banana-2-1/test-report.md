# Nano Banana 2.1 Verification

Prompt for all successful browser generation cases: `生成一张你认为最好看的动漫海报`.
Real requests came from the local OpenTu site to Tuzi's exact generateContent endpoint; no responses were mocked. The credential is excluded from this report and the repository.

## Live Parameter Matrix

All rows below returned HTTP 200. Ratios were tested at 1K with medium Thinking unless stated otherwise.

| Case | Actual output |
| --- | --- |
| Auto | 1376x768 |
| 1:1 | 1024x1024 |
| 1:4 | 512x2064 |
| 1:8 | 352x2928 |
| 2:3 | 848x1264 |
| 3:2 | 1264x848 |
| 3:4 | 896x1200 |
| 4:1 | 2064x512 |
| 4:3 | 1200x896 |
| 4:5 | 928x1152 |
| 5:4 | 1152x928 |
| 8:1 | 2928x352 |
| 9:16 | 768x1376 |
| 16:9 | 1376x768 |
| 21:9 | 1584x672 |
| 2K, 16:9 | 2752x1536 |
| 4K, 16:9 | 5504x3072 |
| minimal Thinking, 1:1 | 1024x1024 |
| high Thinking, 1:1 | 1024x1024 |
| 2 references, 1:1 | 1024x1024 |
| 14 references, 1:1 | 1024x1024 |

Fifteen references were rejected before any network request. The 2/14-reference cases repeat the same generated image and verify count/transport support, not interpretation of distinct references. Matrix cases use the site's generation code inside the browser; auto and subsequent editing also exercise actual UI buttons.

## UI Verification

- Canvas: model selection, text-to-image and image-to-image through actual UI controls succeeded. Editing sent one reference and returned 1376x768. Initial test setup showed the API Key dialog without submitting a request; selecting the explicitly configured channel after reload resolved setup.
- Workflow: uploading a reference then immediately clicking Generate reproduced a race: the request had zero references. This earlier attempt is excluded from valid editing results. Import tracking now disables generation until all reference imports finish, with a synchronous submission guard. The repeated UI test sent one reference and returned 1376x768.
- Desktop 1440x900 and mobile 390x844 parameter controls were inspected. The mobile parameter menu stays inside the viewport and Thinking selection updates its summary. This does not substitute for real-device Safari acceptance.
- Saved text classification is corrected to image after reload and excluded from text selection.

## Output Limits

The 1K 1:8 and 4:1 outputs visibly repeat poster panels. Extreme-ratio dimensions differ from Google's table. Passing HTTP requests therefore does not mean every output meets poster composition expectations. High-resolution extreme ratios, all ratio/resolution/Thinking combinations, search grounding, distinct-reference reasoning and comparative quality against older models were not evaluated.

## Automated Checks

- Independent PR branch: 204 core tests pass; Drawnix typecheck and strict OpenSpec validation pass.
- Affected workflow checks: 116 pass, including the deferred concurrent-upload regression. One GPT Image transparent-background test fails with `图片背景 参数值无效: transparent`.
- The same GPT Image test fails on unmodified `origin/develop` at `647e378d`, confirming a baseline failure. Its behavior is outside this PR.
- Existing Agent TODO items need no changes.
