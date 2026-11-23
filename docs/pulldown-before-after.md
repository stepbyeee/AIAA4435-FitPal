# FitPal 高位下拉 · 改前与改后

原版是 `dcfd98a`。两轮改动都沿用本地 MediaPipe Pose Landmarker Full 预训练权重。高位下拉自动画两侧的肘腕轨迹，任一侧证据中断就清空那侧轨迹，恢复后从当前位置重画。第一次冻结的代码和留出结果保存在 `3aab83a`。第二次调整解决快速回顶和镜头缩放时的校准问题。

| 片段用途 | 原版正式命中 | 最终发布版正式命中 | 原版 / 新版额外正式计数 |
|---|---:|---:|---:|
| 历史漏计复测，4 段 | 6/12（50.0%） | 11/12（91.7%） | 0 / 0 |
| 第一批新片，随后用于诊断，5 段 | 6/16（37.5%） | 7/16（43.8%） | 0 / 0 |
| 最终独立盲测，4 段 | 2/8（25.0%） | 2/8（25.0%） | 0 / 0 |

同源 GO4IT 两组来自同一位训练者。第一批五段新片最初封存时，原版与第一次冻结版均为 6/16。查看这一批的失败后才开发第二次改动。最后四段由另一位执行者先看原始画面定下回顶窗口，两版在同一批帧上评分，整个过程中没有根据这四段的成绩修改规则。每个视频只有一人标注，四段盲测共有八次正式动作，相差一次就会改变 12.5 个百分点。

## 漏在哪一步

- 手腕在最高处出画的 Mixkit 女子片段，原版等不到完整肘角校准。新版额外记录同侧上臂的举起、下拉、还原，要求下方确实看见屈肘，终于算到三次正式动作。三次的幅度字段均为空，逐次回顾和奖励只记录次数。
- 教练走入镜头的 GO4IT，模型开头换过目标，第三次校准仍占用了人工标作正式的第一下。新版能在下一次清楚回顶时重新准备，接下来两下命中。这个版本没有通用的多人身份跟踪。
- 竖屏 Pexels 快速连续动作在顶端没有停顿。新版允许连续观测到伸肘、举腕过肩就准备下拉，并用投影臂长核对镜头移动后的回顶。完整产品命中 **1/5**。单独对原始关键点运行计数器能得到 4/5，发布版的双侧遮挡检查会在机位移动后误断部分可见轨迹。详细窗口见[原因与消融](pulldown-recall-rules.md)。
- 盲测中 Dynamic Fitness 的第一次正式动作被用来补完校准；Life Time 全片未完成校准；Adelaide 在切镜的五次动作中只记录到两次校准；Future Fitness 完成校准后命中 1/2。清晰画出关节和成功确认整次下拉需要分别评价。
- 高速健身片与俯视近景中，Full 每段各有一侧仅在 32/144 帧、21/265 帧形成完整手臂轨迹。用同一批帧补跑预训练 Lite 和 Heavy，两者在这两段都没有完成校准。[模型对照](results/pulldown-r2-difficult-models.json)

## 遮挡与摄像头

同一真人背面片段遮左、右各五秒，固定帧下灰块误画 64/126 → 0/126，反序墙纹误画 12/126 → 0/126。灰块下另一侧保留 50 → 82 帧，墙纹下则从 95 降到 87 帧。虚拟摄像头经过真实 `getUserMedia` 入口后，灰块下仍有 1/42 个采样点误画。自然立柱遮挡的六个明确侧帧从误画 4 个降到 0 个，但明确可见的 39 个侧帧从画出 35 个降到 29 个，关节出框时仍误画 2/18。更严格的过滤会漏掉真实轨迹。地点、真人摄像头、照明和器械种类仍需要现场验证。[逐侧计分口径与证据](pulldown-arm-occlusion.md)

## 分片记录


### 历史漏计复测

| 实录 | 人工完整动作 | 正式参考 | 改前命中 | 改后命中 | 新版校准事件数 |
|---|---:|---:|---:|---:|---:|
| [Mixkit 女子，举腕出画](https://mixkit.co/free-stock-video/woman-using-a-gym-machine-for-strength-training-100523/) | 6 | 3 | 0 | 3 | 3 |
| [分支标准示范](https://commons.wikimedia.org/wiki/File:Lat_pulldown_exercise_demonstration.webm) | 5 | 2 | 2 | 2 | 3 |
| [GO4IT 后视](https://commons.wikimedia.org/wiki/File:47%ED%9A%8C(%EB%93%B1%EC%9A%B4%EB%8F%99)%ED%8C%80GO4IT_%EB%8B%A4%EB%8B%88%EC%97%98,_%EB%B0%95%EC%86%8C%ED%9D%ACby%ED%97%AC%EC%8A%A4%ED%8B%B0%EB%B9%84.webm) | 7 | 4 | 4 | 4 | 3 |
| [GO4IT 教练入镜](https://commons.wikimedia.org/wiki/File:47%ED%9A%8C(%EB%93%B1%EC%9A%B4%EB%8F%99)%ED%8C%80GO4IT_%EB%8B%A4%EB%8B%88%EC%97%98,_%EB%B0%95%EC%86%8C%ED%9D%ACby%ED%97%AC%EC%8A%A4%ED%8B%B0%EB%B9%84.webm) | 6 | 3 | 0 | 2 | 3 |

[逐帧输入校验、校准时间、正式事件和幅度记录](results/pulldown-final-historical.json)

### 第一批新片，随后用于诊断

| 实录 | 人工完整动作 | 正式参考 | 改前命中 | 改后命中 | 新版校准事件数 |
|---|---:|---:|---:|---:|---:|
| [Pexels 竖屏，立柱与移动机位](https://www.pexels.com/video/intense-gym-workout-with-lat-pulldown-35585697/) | 8 | 5 | 0 | 1 | 3 |
| [Venice 街头比赛](https://archive.org/details/youtube--75jWp9QxA4) | 9 | 6 | 6 | 6 | 3 |
| [高速健身房录像](https://archive.org/details/backworkoutwifbbpromr.bubbles) | 6 | 3 | 0 | 0 | 0 |
| [Mixkit 男子，后视近景](https://mixkit.co/free-stock-video/man-working-out-on-a-lat-pulldown-machine-100549/) | 5 | 2 | 0 | 0 | 0 |
| [Pexels 女子，恰好三次校准](https://www.pexels.com/video/a-woman-doing-a-pull-down-exercise-7934717/) | 3 | 0 | 0 | 0 | 0 |

[逐帧输入校验、校准时间、正式事件和幅度记录](results/pulldown-final-diagnostic.json)

### 最终独立盲测

| 实录 | 人工完整动作 | 正式参考 | 改前命中 | 改后命中 | 新版校准事件数 |
|---|---:|---:|---:|---:|---:|
| [Dynamic Fitness 正面器械](https://www.mydynamicfitness.com/post/training-variation-exercise-variability) | 5 | 2 | 1 | 1 | 3 |
| [Life Time 背面中立握](https://experiencelife.lifetime.life/article/your-first-week-of-workouts-at-life-time/) | 5 | 2 | 0 | 0 | 0 |
| [Future Fitness 斜侧面](https://futurefitness.co.uk/exerciselibrary/) | 5 | 2 | 1 | 1 | 3 |
| [City of Adelaide 户外器械切镜](https://commons.wikimedia.org/wiki/File:How_to_use_the_free_City_of_Adelaide_Park_Lands_fitness_equipment_(outdoor_gym).webm) | 5 | 2 | 0 | 0 | 2 |

[逐帧输入校验、校准时间、正式事件和幅度记录](results/pulldown-final-reserve.json)

## 复现

两版各从新建的 Full 实例开始，每段只解码一次，以 15 Hz、最长边 640 像素的无损 PNG 输入同一批帧。匹配沿用项目原有规则，从人工标出的最低位置到回顶后 0.35 秒，一次预测最多匹配一次。每段前三个完整动作预留校准，校准失败后仍把应计正式动作算入漏计。额外正式计数单列。14 段历史短片也跑了两版，其中四段没有可信逐次标签，其余十段均无正式参考及额外正式计数。[短片全量输出](results/pulldown-final-short.json)

在 `ui/` 运行 `python3 scripts/fetch-replay-assets.py --pulldown-holdout` 可还原九段新素材。两份 Vite 开发服务分别使用原版和当前版本，并安装相同的模型和依赖。以下命令重跑最终独立盲测，文件默认留在本机。

```sh
node scripts/paired-pulldown.mjs --before http://127.0.0.1:5240 --after http://127.0.0.1:5241 \
  --manifest ../docs/results/pulldown-r3-reserve-sources.json \
  --media .benchmark-assets/pulldown-r3-unseen --output /tmp/fitpal-paired.json --traces /tmp/fitpal-traces
python3 scripts/score-replay.py --paired /tmp/fitpal-paired.json
```

摄像头和导入录像采用浏览器实时帧回调，默认尝试 GPU，固定帧表格使用 CPU。打包版的浏览器测试中，原片、自动双侧、遮挡、模拟摄像头训练和结算均已跑通。裁腕录像在一次并发负载下的原速回放计到 2/3；同一发布版独立重跑计到 3/3。小尺寸录像三次原速回放分别为 1/2、2/2、2/2。[发布版实测](results/pulldown-final-production-checks.json) · [受控压力回放](results/pulldown-final-stress.json)
