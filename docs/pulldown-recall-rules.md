# 高位下拉漏计复盘

用同一批 MediaPipe Pose Landmarker Full 关键点重放旧规则与新规则，正式动作从 **6/12（50.0%）提高到 11/12（91.7%）**。两版在有标签的片段均有 0 次额外正式计数。这组数字衡量已用于调试的历史素材。摄像头模式还有逐帧遮挡过滤和实时采样，完整流程及新视频的结果应另行查看。[逐次时间、文件与代码指纹](results/pulldown-rules-paired.json)

| 历史视频 | 人工完整动作 | 预留校准 | 旧版正式命中 | 新版正式命中 | 新版正式计数时间（秒） |
|---|---:|---:|---:|---:|---|
| 分支标准示范 | 5 | 3 | 2/2 | 2/2 | 13.733、17.533 |
| GO4IT 后方机位 | 7 | 3 | 4/4 | 4/4 | 21.933、27.667、33.000、38.600 |
| GO4IT 教练入镜 | 6 | 3 | 0/3 | 2/3 | 33.867、40.667 |
| Mixkit 近景 | 6 | 3 | 0/3 | 3/3 | 9.067、11.600、13.800 |

18 个历史窗口中，14 个有逐次参考，4 个的动作边界无法可靠标注。只有表中 4 段在三次校准后还有正式动作。所有有标签的窗口中，校准命中合计 14/24 → 22/24，额外校准事件 3 → 2。新版未匹配的校准事件分别出现在 GO4IT 教练入镜片段和 hf-lat-27。前者的第三次校准占用了本应计入正式训练的第四个动作。hf-lat-47 的动作边界没有可靠标签，在该片段出现的一个校准事件无法判定对错。go4it-rear 和 go4it-coach 来自同一源片、同一位训练者的不同组。[主清单](results/replay-sources.json) · [近景清单](results/external-pulldown-mixkit-sources.json)

## 漏计原因与改动

- **近景手腕越出上边界。** Mixkit 选手完成六次下拉，最后第七次只有下行。原规则把手腕、肘、肩同时清晰作为观测肘角的条件，每次最高点都失去肘角，整段无法校准。现在可在同一侧连续看到肩和肘时，单独测上臂相对画面竖直向下方向的抬高角。连续三个上下往返中至少两个出现手腕越过上边界，且每次低位能清楚看到同侧屈肘，才启用这种计数。每次正式计数保留缺失的肘幅度值，画面和结算可据此显示“仅计数”。第七次未回顶，产生 0 次计数。
- **慢回顶和连续下拉。** GO4IT 教练入镜段中，旧版直到 13.067、28.867 和 41.400 秒才依次确认三次校准。手腕高度与肘角须同时接近起点，旧规则对慢回顶的终点偏差过于敏感，还会在一次合格回顶后重新要求停住。新规则要求肘角在本次行程的上方 24% 以内（允许误差上限 26°），同时腕部相对肩的高度须接近起始高度，允许偏差取可见手腕行程的 18% 或画面高度的 1.2% 中较大者。下一次可直接从实际观察到的顶姿开始。当前单人模型在开头选到前景教练，直到训练者第一个低位已过才返回训练者，留下一个正式漏计。
- **两只手瞬间被模型投到同一处。** 后方机位在 0.933 和 1.200 秒出现这类错误，自动过滤会同时断开两侧轨迹。重新看到同侧肩膀、肘角和手腕高度都处于刚才的顶姿时，可恢复校准准备。正在进行的下拉仍会因中断失去验证资格。遮挡期间没有插补手腕或拼接左右手。近景中仅当低位已经确认、手腕仍清楚可见时，允许肘部短时间越出画面下边缘。

## 复现

基线代码取自 dcfd98a。两版规则读取同一份逐帧关键点，固定每秒 15 帧，画面最长边 640 像素，使用浏览器 CPU 推理。使用既有 score-replay.py 将一次预测最多匹配一个参考窗口，匹配区间从人工最低点至人工回顶后 0.35 秒，校准失败时仍保留之后应计的正式动作。JSON 中包含全部窗口、原视频、逐帧输入以及每个规则源文件的 SHA-256。原始视频及关键点在本地缓存中。[评分实现](../ui/scripts/score-replay.py) · [原有固定帧协议](model-comparison.md)

在 ui/ 目录运行以下命令。将 OLD_UI 换成冻结基线的 ui 目录。前两行需要已运行的本地 Vite 服务和本地评测视频；主清单中也含深蹲，缓存时可用 --clip 指定其中的高位下拉文件名。

```sh
node scripts/compare-models.mjs --models full --manifest ../docs/results/replay-sources.json --frame-cache .benchmark-assets/pose-frames --output .benchmark-assets/full-main.json
node scripts/compare-models.mjs --models full --manifest ../docs/results/external-pulldown-mixkit-sources.json --frame-cache .benchmark-assets/pose-frames --output .benchmark-assets/full-mixkit.json
node scripts/compare-pulldown-rules.mjs --baseline "$OLD_UI" --frames .benchmark-assets/pose-frames --manifest ../docs/results/replay-sources.json --manifest ../docs/results/external-pulldown-mixkit-sources.json --output .benchmark-assets/pulldown-rules-paired.json
```
