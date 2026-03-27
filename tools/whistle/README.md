# Whistle Base64 Image Mock

This folder contains a Whistle ruleset for reproducing image-model responses
that return raw base64 image payloads instead of normal remote URLs.

## Files

- `mock-image-base64.rules`: paste this into Whistle Rules.

## Supported scenarios

- `__mock_b64_single__`: returns one image in `data[0].b64_json`
- `__mock_b64_duplicate__`: returns two identical images in `data[].b64_json`
- `__mock_b64_url_field__`: returns one image whose raw base64 is placed in `data[0].url`

## How to use

1. Open Whistle and paste the contents of `mock-image-base64.rules` into the
   Rules editor.
2. Make sure HTTPS capture is enabled for `api.tu-zi.com`.
3. In AITU, keep the image Base URL pointed at `https://api.tu-zi.com/v1`
   unless you intentionally use another domain.
4. Add one of the marker strings above to the prompt text and submit an image
   generation request.

## Notes

- The rules match both `/v1/images/generations` and `/images/generations`.
- If you use a non-default API host, replace `api.tu-zi.com` in the rules.
- If you want to stress-test large payload handling, replace the embedded
  base64 string with the real raw payload from your captured response text.
- The duplicate scenario is useful for verifying that identical base64 payloads
  are deduplicated into the same local cache file.
