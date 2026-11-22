# Optional local Chinese cue wording

Open the FitPal dev site on `http://127.0.0.1:5190/?coach=local` after starting the model below. This mode is intended for a laptop running both FitPal and the model. Classroom study conditions retain their fixed wording.

After a set, the decision policy selects the issue and settles EXP. For a short-range or visibility cue, FitPal sends a small set of true Chinese observations and appropriate actions to a loopback llama.cpp server. A pretrained Qwen model composes the cue from one observation and one action. FitPal compares both returned strings with the permitted options before displaying one cue. A clean set skips inference. A missing service, a response outside the allowed vocabulary or a 3.5-second timeout uses the existing rule text. The request carries no video, landmarks, movement traces, personal identifier or workout history. The model receives no free-text user input.

## Start on Apple silicon

From the repository root, prepare the public, pinned weights and runtime once. The local directory is ignored by Git.

```sh
mkdir -p .local-coach
curl -fL 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/9217f5db79a29953eb74d5343926648285ec7e67/qwen2.5-0.5b-instruct-q4_k_m.gguf' -o .local-coach/qwen-q4_k_m.gguf
curl -fL 'https://github.com/ggml-org/llama.cpp/releases/download/b12633/llama-b12633-bin-macos-arm64.tar.gz' -o .local-coach/runtime.tgz
echo '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db  .local-coach/qwen-q4_k_m.gguf' | shasum -a 256 -c -
echo '99657876053df9004753d92075813bbb3b484e79f8a402809b51d00c8c540062  .local-coach/runtime.tgz' | shasum -a 256 -c -
tar -xzf .local-coach/runtime.tgz -C .local-coach
```

Launch the server after both hashes match. Use the single exact origin shown in your browser’s address bar for `--cors-origins`. The command below matches the local demo links. The optional `coach=local` query can be combined with a recorded video.

```sh
.local-coach/llama-b12633/llama-server -m .local-coach/qwen-q4_k_m.gguf \
  --alias fitpal-qwen --host 127.0.0.1 --port 5191 --ctx-size 2048 --parallel 1 \
  --cors-origins http://127.0.0.1:5190 --no-webui --verbosity 2
```

The GGUF file is 491,400,032 bytes (469 MiB). Downloads contain the model and runtime only. Inference works offline once the app’s local assets have also been prepared. [Qwen’s Apache-2.0 model card](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF) · [llama.cpp release](https://github.com/ggml-org/llama.cpp/releases/tag/b12633)

## Check the behavior

Run `npm test` in `ui` for the validation and fallback cases. With Vite and the loaded model running, `node scripts/check-local-coach.mjs` in `ui` exercises a real Chrome origin and a real model call. As for the video benchmark, set `FITPAL_PLAYWRIGHT` to an installed Playwright ES module and `FITPAL_CHROME` to a Chromium executable when necessary.

The saved [five-case result](results/local-coach-qwen.json) uses synthetic set summaries. The two range cases and two visibility cases each returned one accepted cue. The clean set made zero calls. Warm local response times include request, inference, validation and delivery in Chrome, and exclude server startup. In these examples the small model selected the first phrasing offered in each field, even when given a more specific alternative. The experiment establishes the local integration and output constraints. Naturalness and benefit over the deterministic cue still need participant ratings.

For a full UI regression, prepare a controlled dropout from the branch’s original Your Move pulldown demo. From `ui`, the following adds 0.6 seconds of black video during the fourth pull. The underlying movement is real. The dropout is a test manipulation.

```sh
ffmpeg -i public/demo/pulldown.webm -map 0:v:0 -an \
  -vf "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,12.40,13.00)'" \
  -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -movflags +faststart \
  public/demo/pulldown-test-blackout.mp4
node scripts/check-local-coach.mjs --blackout
```

The test opens FitPal’s normal session screen with the modified demo, waits for three calibration pulls, checks both review plots for a gap in the first scored rep, selects the second scored rep and checks its bottom markers. It also checks for one model request, +1 EXP on the result screen, and an untouched workout history. To try this case on the same machine, open [the controlled-dropout replay](http://127.0.0.1:5190/?video=pulldown-test-blackout.mp4&coach=local#/session/lat-pulldown). The source page lists Your Move and reports an outstanding deletion nomination about the original license evidence. This local test uses the existing fixture. [Source record](https://commons.wikimedia.org/wiki/File:Lat_pulldown_exercise_demonstration.webm)
