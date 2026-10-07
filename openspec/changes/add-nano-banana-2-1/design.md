## Context
The shared catalog drives canvas and workflow controls. Provider bindings determine both endpoint and auth; the existing Gemini client handles Google parts and reference-image conversion. The workspace contains unrelated uncommitted changes that must be preserved.

## Decisions
- Keep one exact model ID and independent resolution parameter, avoiding synthetic 2K/4K model aliases.
- Reuse the extended-ratio configuration. Add Thinking only for 2.1, with medium as the default.
- Add a Tuzi-specific exact-ID Google binding. Preserve generic providers and previous Gemini/GPT bindings.
- Map Thinking to `generationConfig.thinkingConfig.thinkingLevel` for generateContent. Reject invalid new-model values and excess references before submission.
- Continue using the selected profile's existing auth strategy; never embed the test credential.
- Ignore thought parts in image outputs so intermediate thought images cannot become final canvas assets.

## Risks And Trade-offs
Tuzi delivered 1K, 2K and 4K in live browser tests. Extreme ratios can differ from the official pixel table. Full-gallery inspection found repeated poster panels at 1K in 1:4, 1:8, 3:2, 4:1, 8:1 and 21:9 outputs. These are upstream output limitations, not HTTP failures. Search grounding remains disabled until separately verified.

## Migration
Existing provider/model discovery uses the shared catalog metadata. The exact model is corrected to image capability when saved channels are normalized, retaining channel settings. No storage schema migration is required.

## Research Record
Source: https://ai.google.dev/gemini-api/docs/image-generation

Official documentation (updated October 2026) describes the following Nano Banana 2.1 output sizes:

| Ratio | 1K | 2K | 4K |
|---|---:|---:|---:|
| 1:1 | 1024x1024 | 2048x2048 | 4096x4096 |
| 1:4 | 512x2048 | 1024x4096 | 2048x8192 |
| 1:8 | 384x3072 | 768x6144 | 1536x12288 |
| 2:3 | 848x1264 | 1696x2528 | 3392x5056 |
| 3:2 | 1264x848 | 2528x1696 | 5056x3392 |
| 3:4 | 896x1200 | 1792x2400 | 3584x4800 |
| 4:1 | 2048x512 | 4096x1024 | 8192x2048 |
| 4:3 | 1200x896 | 2400x1792 | 4800x3584 |
| 4:5 | 928x1152 | 1856x2304 | 3712x4608 |
| 5:4 | 1152x928 | 2304x1856 | 4608x3712 |
| 8:1 | 3072x384 | 6144x768 | 12288x1536 |
| 9:16 | 768x1376 | 1536x2752 | 3072x5504 |
| 16:9 | 1376x768 | 2752x1536 | 5504x3072 |
| 21:9 | 1584x672 | 3168x1344 | 6336x2688 |

Compared with Nano Banana 2, 2.1 adds the medium Thinking level (2 had minimal/high), improves realism, prompt adherence, multi-turn consistency and text/infographic rendering, and fixes wide-ratio tiling at 2K/4K. Compared with Nano Banana Pro, it targets Flash speed/cost and supports the same 14-reference-image scale while trading away Pro's higher-end quality positioning. Official inputs include text/image/video/PDF; this image task only wires text and image parts. Function calling is unsupported.

Tuzi verification used the requested `generateContent` endpoint with the prompt `生成一张你认为最好看的动漫海报`, without storing the credential. All 14 ratios at 1K/medium, auto ratio, all three Thinking levels, and 2K/4K at 16:9 returned images. 4K returned 5504x3072, replacing the earlier timeout-only result. Two and fourteen repeated references were accepted; fifteen were rejected locally before network submission. Canvas UI generation and editing both returned 1376x768, with the edit request carrying one reference. Workflow UI retesting exposed and fixed an asynchronous upload race; the successful repeat carried one reference and returned 1376x768. This is one-factor parameter coverage, not every Cartesian combination or distinct-reference reasoning evaluation. Full dimensions and limitations are in `test-report.md`.

A deliberately invalid 512 request was accepted by the gateway and returned 5856x704; the application therefore does not expose 512 for this model. The official quality claims above are research findings, not conclusions from this poster test.
