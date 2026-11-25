# Trial 1 historical source

The original local text-versus-native comparison covered Qwen3-Coder 30B, GPT-OSS 20B, and Devstral 24B. The six run manifests are in `manifests/`.

## Verified text source

| Model | Recorded Git commit | Snapshot |
|---|---|---|
| Qwen3-Coder 30B | `c44d09bee046182440a6f0d0f08f0e93272d3d7c` | `text/qwen3-coder-30b/` |
| GPT-OSS 20B | `9260bee48980a2c800301ead9aebcaf01e7a469d` | `text/gpt-oss-20b/` |
| Devstral 24B | `48bf182b10b5afe8a384a1c0740704aa82aa3fab` | `text/devstral-24b/` |

Each directory contains the harness source and benchmark configuration from its recorded commit. All three committed copies of `agent.ts` match the corresponding run manifest's SHA-256.

## Native source provenance

All three native manifests record `c3a44a7c53ada42152825fc8407af26e8beabeff`. That commit has a different `agent.ts` hash and contains no `tools.ts`. Neither file at the later native-tools commit `a93a680` matches the native run hashes. The manifest hashes preserve the expected identities, but the exact native source was unavailable in the checked Git history. The native half cannot be reproduced from this snapshot alone.

Verify the archived files from this directory with `shasum -a 256 -c SHA256SUMS`.
