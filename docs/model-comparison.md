# FitPal 视频回放与预训练模型比较

FitPal 在线训练默认使用 MediaPipe Pose Landmarker Full。对比实验在同一批真实录像上替换预训练权重，复用应用的计数、遮挡处理、个人校准和幅度判断。所有模型均未训练或微调。[Google 模型说明](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)

## 素材与协议

主对比固定 22 个时间窗，来自 21 个源视频。两条是分支原有的高位下拉 demo。外部素材包括五条深蹲示范、四条 Pexels 下拉、九条 workout-vids 下拉，以及韩国训练课的两个不同机位／组。两个韩国时间窗来自同一位训练者。YMove 另有一个与原有标准下拉相同的 MP4 版本，已排除。[主清单和逐次参考时间](results/replay-sources.json)

另外选取 Szatstrength 健身房视频里的两名不同训练者，分别在低机位斜前方和侧面完成 7 和 9 次杠铃深蹲，作为外部补充。团队成员尚未对时间标注做独立双人复核。新素材由助手在不看模型输出时，检查带时间戳的原片帧并标出完整动作及返回时间。已用于开发的两条分支录像和 YMove 深蹲 demo 单独注明。[外部深蹲清单](results/squat-supplement-sources.json)

- **同帧对比。** FFmpeg 将长边缩放至 640 像素、保留纵横比，以 15 fps 导出无损 PNG。每个模型收到相同的图片和视频时间戳。每个视频窗口重新加载模型和状态机。顺序不循环，不跨人、跨镜头或跨片复用校准值。
- **事件匹配。** 前三下按校准事件核对，其余按正式计数核对。每个事件只能与一次回程匹配，窗口从参考底部到回到顶部后 0.35 秒。校准失败时仍计入后续应计动作的漏计。腕部出框导致无法判断的素材保留作为压力测试。没有逐次幅度真值，故未计算幅度分类准确率。
- **覆盖率。** 同侧肩、肘、腕或髋、膝、踝均在画内、可见分数至少 0.60，且两段长度都超过画面短边的 1.5%，才将这一侧记为可用。表中的单侧、任侧及状态机可见率按采样帧数计算。多人画面中，模型可能选到教练，几何可见率不能验证身份。
- **耗时。** 每帧测量 CPU 委托下调用 detectForVideo 并转换返回关键点的墙钟时间；首帧单列，暖态统计排除首帧。此路径未包含读取 PNG、图像解码、摄像头传输及屏幕刷新。实测环境为 Apple M5、Chrome 157。期间还有其他浏览器测试，速度只作本机参考。原始 1× 浏览器回放另有单独记录。[原有实时回放协议](pulldown-validation.md)

## 可计数的动作

表格中的分子仅包括与回程时间匹配的**训练**次数。每段预留前三下做个人校准，分母是该次序中所有剩余完整动作。未按时完成校准也保留在分母中。最后两行是单独增加的深蹲测试，结果保留在独立文件。[逐模型输出](results/model-comparison.json) · [补充测试输出](results/squat-supplement-comparison.json)

| 录像、机位 | 参考总次数 | Lite | Full | Heavy |
| --- | ---: | ---: | ---: | ---: |
| 原有标准下拉，正侧面，开发样本 | 5 | 0/2 | 2/2 | 2/2 |
| GO4IT 下拉，固定后视，单人 | 7 | 4/4 | 4/4 | 0/4 |
| GO4IT 下拉，同一人另一组，教练入镜 | 6 | 0/3 | 0/3 | 0/3 |
| YMove 杠铃后蹲，斜前视 | 4 | 1/1 | 1/1 | 1/1 |
| YMove 哑铃杯式深蹲，产品示范 | 5 | 2/2 | 2/2 | 2/2 |
| YMove 壶铃杯式深蹲，同一工作室 | 5 | 2/2 | 2/2 | 2/2 |
| Szatstrength 杠铃深蹲，斜前方低机位，旁有保护者 | 7 | 1/4 | 0/4 | 0/4¹ |
| Szatstrength 杠铃深蹲，侧面，另一位训练者 | 9 | 2/6 | 6/6 | 6/6 |

¹ Heavy 在斜前低机位片段输出过 1 次训练计数，但时间落在参考回程以外，记为一个多计和四个漏计。Lite 的三个校准事件都晚于该片段按协议预留的前三次，在最后一次输出了能匹配的训练事件。

**机位比增加参数更能改变这一组的结果。** Full 在 GO4IT 的独立单人后视镜头匹配 3 次校准、4 次训练，换到同一位训练者和教练一起出现时漏掉 3 次训练。独立深蹲也有相同的落差，侧面后六次均匹配，另一人的斜前低机位中未完成校准。这些片段无法单独区分机位、动作、衣着及其他人入镜的影响。原始帧率或取景区域不同，结果也可能改变。

在最终 Full 页面实录中，GO4IT 后视镜头完成 3 次校准、确认 4 次，点选了第 4 下的回顾。约第 24 秒双手到达画面上沿时，左侧提示未看清，右侧仍短暂出现横向轨迹，再恢复到手臂附近。计数正确与逐帧定位准确需要分别评估，此处没有关键点真值。GO4IT 标签在首次比较前确定，其失败样例随后用于探索取景选区。主表为最终规则在未裁切画面上的复跑，Szatstrength 两个补充窗口则在计数规则冻结后首次送入模型。另一个模型家族也在相同 PNG 和动作规则上做了小样本测试。[MoveNet 对比及置信度敏感性](movenet-benchmark.md)

## 计数与耗时汇总

主矩阵共 66 次运行，每个模型处理相同的 4,919 帧。六个足够长的窗口里预留了 14 次正式训练动作。Lite 匹配 9/14，Full 11/14，Heavy 7/14，均无多计。Full 的三个漏计都在教练共同入镜的窗口。单看新来源的两个 GO4IT 窗口，Full 匹配 4/7，原有开发下拉片单独为 2/2。补充深蹲共 6 次运行，每个模型 1,087 帧、10 次可计训练动作；Full 匹配 6/10、无多计。小样本和机位差异很大，现有结果未达到提案对正式计次召回率 ≥90% 的验证目标。

| 22 个主窗口，各片暖态推理 P95 的中位数 | Lite | Full | Heavy |
| --- | ---: | ---: | ---: |
| 毫秒 | 22.6 | 33.7 | 120.9 |
| 单片 P95 的最小至最大值，毫秒 | 15.9–41.4 | 22.1–55.1 | 75.7–189.7 |

在这些录像上，Full 在正侧面和后方的干净下拉机位都能完成校准和计数，并匹配外部侧拍深蹲的 6 次正式动作。Lite 在分支原有侧面下拉未能校准，Heavy 在新的单人后视下拉只登记了一次校准。保留 Full 作默认设置有以上实测依据。

## 短片、遮挡和错误触发

workout-vids 的下拉目录包含 51 个视频，我们核对了整个目录的时长，范围为 1.27–14.00 秒。所测九条覆盖不同视角、裁切和动作截断。八条能标完整或零次参考，共有 10 个可匹配的校准阶段动作。Lite 匹配 5 个，Full 匹配 6 个，Heavy 匹配 5 个；三者在第 27 号片段都各多报一次校准事件。三模型在九条上均无正式训练计数。将这些短片循环至“完成三次”会把同一次动作重复当成证据，所以评测逐片重置并停在原片末尾。

Pexels 的慢动作正后视样本 `5983521` 只有一次完整下拉，三模型均登记了一次校准、零次训练。人脸特写 `3209802` 使用 Full 时任侧手臂仅约 3.6% 的帧满足取景要求，CRiles23 的深蹲讲解近景中 Full 的双腿在 790 个采样帧里始终无法满足整条腿的要求。相比之下，在 GO4IT 教练入镜的窗口，Full 的任侧几何可见率约 99.5%，三个训练动作仍然漏计。取景提示、身份选择和连续动作证据各自影响结果。

## 如何复现

在 `ui/` 安装项目依赖、准备本地 WASM、启动 Vite dev server。Python 3、FFmpeg、Playwright 和 Chromium 是额外的本地评测依赖。Playwright 可通过 `FITPAL_PLAYWRIGHT` 指向本机的绝对模块路径，`FITPAL_CHROME` 可指定 Chrome 可执行文件。默认地址是 `http://127.0.0.1:5190`。

```sh
npm install
npm run setup:pose
python3 scripts/fetch-replay-assets.py --include-dataset
python3 scripts/fetch-replay-assets.py --supplementary
npm run dev
```

另开一个终端，在同一 `ui/` 目录运行以下命令。脚本按 SHA-256 拒绝已变更的源视频，记录模型与感知源码指纹，校验完成前不应将中间文件作为完整结果。若媒体站点限流，等待其 Retry-After 时间后重试；脚本会跳过已校验文件。

```sh
node scripts/compare-models.mjs --output main-report.json
python3 scripts/score-replay.py main-report.json > main-events.json
node scripts/compare-models.mjs --supplementary --output squat-report.json
python3 scripts/score-replay.py --supplementary squat-report.json > squat-events.json
```

可通过 `--models full` 或 `--clip go4it-rear.webm` 缩小复跑范围。评测素材、Lite、Heavy 和可选 MoveNet 存在 `ui/.benchmark-assets/`，不会随生产构建发布。分支原有的本地回归素材放在 Git 已忽略的 `ui/public/demo/`。`--app-only` 仅准备这组素材。发布版的内置示范单独放在 `ui/public/showcase/`。`--include-dataset` 按固定版本的 ZIP 字节范围提取指定下拉片段；来源卡未列出原始视频授权，保留本地评测用途。原有两条 Commons demo 的版权状态需按文件历史复核，避免重新发布有争议的素材。[YMove 素材条款](https://github.com/ymove-app/exercise-api/tree/main/free-videos) · [Pexels 素材条款](https://www.pexels.com/license/) · [workout-vids 数据集](https://huggingface.co/datasets/34data/workout-vids) · [韩国训练课来源](https://commons.wikimedia.org/?curid=61802622)

## 独立来源补测：六次器械下拉

冻结主实验后，另选一段 Mixkit 的背后斜侧面固定机位原片。视频长 15.43 秒，一位训练者做完了六次双臂器械下拉，第七次只留下半程。每次把手回到最高点时，手腕都会越过画面上缘。按 4 Hz 查看原片，先记录六组「最低点至回顶」时间窗，再使用原有 Full 模型和固定帧评测流程。所有时间窗均由同一位评测者目视标注。[原视频与许可](https://mixkit.co/free-stock-video/woman-using-a-gym-machine-for-strength-training-100523/) · [预先标注和文件指纹](results/external-pulldown-mixkit-sources.json)

| 场景 | 抽帧 | 前三次校准命中 | 后三次正式计数命中 | 未匹配正式事件 | 有可用手臂的帧 |
|---|---:|---:|---:|---:|---:|
| 双臂最高处出画 | 231 | 0/3 | 0/3 | 0 | 左 4.3%，右 56.3%，任一侧 60.6% |

Full 全程未能建立校准。人工能根据上臂和随后反向的动作识别循环，系统则需要连续看到同侧肩、肘、腕。这个失败样本保留在补测里。它说明在镜头前试高位下拉时，取景需要覆盖握把的最高点。一次近景测试无法估计一般场景的漏计率。[逐片结果](results/external-pulldown-mixkit-full.json)

筛选时也检查了 Mixkit 的另一条背部近景，它从下拉的最低处开始，只有五次完整的顶至顶循环。Broomfield County 的 43.6 秒示范看起来有六次，画面比对发现约 21.77 秒处开始重播原先的三次。两段均未加入本轮六次以上的样本。[Mixkit 男性示范](https://mixkit.co/free-stock-video/man-working-out-on-a-lat-pulldown-machine-100549/) · [Broomfield 原片](https://www.youtube.com/watch?v=_T2I1nX2c9Y)

可从上述 Mixkit 来源页下载 720p 版本，存为 `ui/.benchmark-assets/video/mixkit-100523.mp4`。在 `ui/` 使用运行中的 Vite 服务执行：

```sh
node scripts/compare-models.mjs --models full --manifest ../docs/results/external-pulldown-mixkit-sources.json --video-dir .benchmark-assets/video --output mixkit-full.json
python3 scripts/score-replay.py --manifest ../docs/results/external-pulldown-mixkit-sources.json mixkit-full.json
```
